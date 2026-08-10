import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import {
  configureNodemailerProxy,
  createProxyTunnelSocket,
  fetchIpWhoIsThroughProxy,
  isSupportedProxyUrl,
} from '../../../../lib/smtp-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SmtpSecurity = 'starttls' | 'ssl' | 'none';
type SmtpAuthMethod = 'auto' | 'LOGIN' | 'PLAIN' | 'CRAM-MD5';

type ProxyTestInput = {
  id: string;
  url: string;
};

type ProxyTestResult = {
  id: string;
  url: string;
  ok: boolean;
  webOk: boolean;
  smtpOk: boolean;
  latencyMs: number;
  smtpLatencyMs?: number;
  smtpHost?: string;
  smtpPort?: number;
  ip?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  reason?: string;
  smtpReason?: string;
};

async function testSmtpTunnel(
  proxyUrl: string,
  smtpHost: string,
  smtpPort: number,
  timeoutMs = 10_000
): Promise<{ ok: boolean; latencyMs: number; reason?: string }> {
  const started = Date.now();
  let socket: import('node:net').Socket | undefined;

  try {
    socket = await createProxyTunnelSocket(
      proxyUrl,
      smtpHost,
      smtpPort,
      timeoutMs
    );

    return {
      ok: true,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    socket?.destroy();
  }
}

async function withHardTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} hard timeout after ${timeoutMs} ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function testOneProxy(
  proxy: ProxyTestInput,
  smtpHost?: string,
  smtpPort?: number
): Promise<ProxyTestResult> {
  const started = Date.now();

  let webResult: {
    ok: boolean;
    ip?: string;
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    reason?: string;
  } = { ok: false };

  try {
    const data = await fetchIpWhoIsThroughProxy(proxy.url, 12_000);

    if (data.success === false || !data.ip) {
      const message = String(data.message || 'IP lookup failed');
      throw new Error(message);
    }

    webResult = {
      ok: true,
      ip: String(data.ip || ''),
      country: String(data.country || ''),
      countryCode: String(data.country_code || '').toUpperCase(),
      region: String(data.region || ''),
      city: String(data.city || ''),
    };
  } catch (error) {
    const value = error as {
      code?: string;
      message?: string;
      response?: { status?: number };
    };

    const code = String(value?.code || '').trim();
    const message = String(value?.message || error || 'Proxy web test failed');
    webResult = {
      ok: false,
      reason: `${code ? `${code}: ` : ''}${message}`,
    };
  }

  let smtpResult: { ok: boolean; latencyMs?: number; reason?: string } = {
    ok: true,
  };

  if (smtpHost && smtpPort) {
    smtpResult = await testSmtpTunnel(proxy.url, smtpHost, smtpPort, 10_000);
  }

  const overallOk = webResult.ok && smtpResult.ok;

  return {
    id: proxy.id,
    url: proxy.url,
    ok: overallOk,
    webOk: webResult.ok,
    smtpOk: smtpResult.ok,
    latencyMs: Date.now() - started,
    smtpLatencyMs: smtpResult.latencyMs,
    smtpHost,
    smtpPort,
    ip: webResult.ip,
    country: webResult.country,
    countryCode: webResult.countryCode,
    region: webResult.region,
    city: webResult.city,
    reason: !webResult.ok ? webResult.reason : undefined,
    smtpReason: !smtpResult.ok ? smtpResult.reason : undefined,
  };
}

async function testProxyPool(
  proxies: ProxyTestInput[],
  smtpHost?: string,
  smtpPort?: number
) {
  const results: ProxyTestResult[] = new Array(proxies.length);
  let cursor = 0;
  const workerCount = Math.min(6, Math.max(1, proxies.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= proxies.length) return;
        try {
          results[index] = await withHardTimeout(
            testOneProxy(proxies[index], smtpHost, smtpPort),
            20_000,
            `Proxy ${index + 1} test`
          );
        } catch (error) {
          results[index] = {
            id: proxies[index].id,
            url: proxies[index].url,
            ok: false,
            webOk: false,
            smtpOk: false,
            latencyMs: 20_000,
            smtpHost,
            smtpPort,
            reason: error instanceof Error ? error.message : String(error),
            smtpReason: error instanceof Error ? error.message : String(error),
          };
        }
      }
    })
  );

  return results;
}

type SmtpAccount = {
  id: string;
  label: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  authMethod?: SmtpAuthMethod;
  username: string;
  password: string;
  fromEmail: string;
  enabled: boolean;
  maxSends: number;
};

function classifyError(error: unknown): {
  kind: 'invalid' | 'timeout';
  reason: string;
} {
  const value = error as {
    code?: string;
    responseCode?: number;
    command?: string;
    message?: string;
  };

  const code = String(value?.code || '').toUpperCase();
  const message = String(value?.message || error || 'Unknown SMTP error');

  const timeoutCodes = new Set([
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNREFUSED',
    'EPROXY',
  ]);

  if (
    timeoutCodes.has(code) ||
    /timeout|timed out|socket hang up|connection reset|proxy/i.test(message)
  ) {
    return {
      kind: 'timeout',
      reason: `${code ? `${code}: ` : ''}${message}`,
    };
  }

  return {
    kind: 'invalid',
    reason: `${code ? `${code}: ` : ''}${message}`,
  };
}

function createTransport(
  account: SmtpAccount,
  proxyUrl?: string,
  authMethodOverride?: Exclude<SmtpAuthMethod, 'auto'>
) {
  const connectionTimeout = proxyUrl ? 12_000 : 20_000;
  const greetingTimeout = proxyUrl ? 12_000 : 20_000;
  const socketTimeout = proxyUrl ? 30_000 : 30_000;

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.security === 'ssl',
    requireTLS: account.security === 'starttls',
    ignoreTLS: account.security === 'none',
    ...((authMethodOverride || (account.authMethod && account.authMethod !== 'auto' ? account.authMethod : undefined))
      ? { authMethod: authMethodOverride || account.authMethod }
      : {}),
    auth: {
      user: account.username,
      pass: account.password,
    },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
  });

  configureNodemailerProxy(transporter, proxyUrl, connectionTimeout); 

  return transporter;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body?.action === 'testProxies') {
      const proxies = Array.isArray(body.proxies)
        ? (body.proxies as unknown[])
            .map((item, index) => {
              const value = (item || {}) as Record<string, unknown>;
              return {
                id: String(value.id || `proxy-${index + 1}`),
                url: String(value.url || '').trim(),
              };
            })
            .filter((proxy) => isSupportedProxyUrl(proxy.url))
        : [];

      if (!proxies.length) {
        return NextResponse.json(
          { success: false, error: 'No valid HTTP/HTTPS/SOCKS5 proxies supplied' },
          { status: 400 }
        );
      }

      const smtpHost = String(body.smtpHost || '').trim() || undefined;
      const parsedPort = Number(body.smtpPort || 0);
      const smtpPort =
        Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
          ? parsedPort
          : undefined;

      const results = await testProxyPool(proxies, smtpHost, smtpPort);

      return NextResponse.json({
        success: true,
        target:
          smtpHost && smtpPort
            ? { host: smtpHost, port: smtpPort }
            : null,
        results,
        working: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
      });
    }

    const accounts = Array.isArray(body.accounts)
      ? (body.accounts as SmtpAccount[])
      : [];

    const proxyUrl =
      typeof body.proxyUrl === 'string' && isSupportedProxyUrl(body.proxyUrl)
        ? body.proxyUrl
        : undefined;

    if (!accounts.length) {
      return NextResponse.json(
        { success: false, error: 'No SMTP accounts supplied' },
        { status: 400 }
      );
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        const valid: SmtpAccount[] = [];
        const invalid: Array<SmtpAccount & { reason: string }> = [];
        const temporaryTimeouts: Array<SmtpAccount & { reason: string }> = [];

        try {
          for (let index = 0; index < accounts.length; index += 1) {
            const account = accounts[index];
            const current = index + 1;
            const total = accounts.length;

            console.log(
              `[SMTP TEST ${current}/${total}] Testing ${account.username || account.fromEmail || account.label} -> ${account.host}:${account.port}`
            );

            emit({
              type: 'testing',
              index: current,
              total,
              accountId: account.id,
              label: account.label,
              fromEmail: account.fromEmail,
              host: account.host,
              port: account.port,
              account: {
                id: account.id,
                label: account.label,
                host: account.host,
                port: account.port,
                security: account.security,
                username: account.username,
                fromEmail: account.fromEmail,
                enabled: account.enabled,
                maxSends: account.maxSends,
              },
            });

            if (proxyUrl) {
              const tunnel = await testSmtpTunnel(
                proxyUrl,
                account.host,
                account.port,
                10_000
              );

              if (!tunnel.ok) {
                const reason = `Proxy cannot open SMTP tunnel to ${account.host}:${account.port}: ${tunnel.reason || 'CONNECT failed'}`;
                const result = { ...account, reason };
                temporaryTimeouts.push(result);

                console.warn(
                  `[SMTP TEST ${current}/${total}] TIMEOUT ${account.username || account.fromEmail || account.label} -> ${account.host}:${account.port} — ${reason}`
                );

                emit({
                  type: 'result',
                  status: 'timeout',
                  index: current,
                  total,
                  accountId: account.id,
                  label: account.label,
                  fromEmail: account.fromEmail,
                  host: account.host,
                  port: account.port,
                  account: result,
                  reason,
                });
                continue;
              }
            }

            const requestedAuthMethod = account.authMethod || 'auto';
            const authMethods: Array<Exclude<SmtpAuthMethod, 'auto'>> =
              requestedAuthMethod === 'auto'
                ? ['LOGIN', 'PLAIN', 'CRAM-MD5']
                : [requestedAuthMethod];

            let verified = false;
            let lastError: unknown = null;
            let detectedAuthMethod: Exclude<SmtpAuthMethod, 'auto'> | undefined;

            for (const authMethod of authMethods) {
              const transporter = createTransport(account, proxyUrl, authMethod);

              try {
                await transporter.verify();
                verified = true;
                detectedAuthMethod = authMethod;
                break;
              } catch (error) {
                lastError = error;
                const classified = classifyError(error);
                if (classified.kind === 'timeout') {
                  break;
                }
              } finally {
                transporter.close();
              }
            }

            if (verified && detectedAuthMethod) {
              const verifiedAccount = { ...account, authMethod: detectedAuthMethod };
              valid.push(verifiedAccount);

              console.log(
                `[SMTP TEST ${current}/${total}] VALID ${account.username || account.fromEmail || account.label} -> ${account.host}:${account.port} — AUTH ${detectedAuthMethod}`
              );

              emit({
                type: 'result',
                status: 'valid',
                index: current,
                total,
                account: verifiedAccount,
                accountId: account.id,
                label: account.label,
                fromEmail: account.fromEmail,
                host: account.host,
                port: account.port,
                authMethod: detectedAuthMethod,
              });
            } else {
              const classified = classifyError(lastError);
              const result = { ...account, reason: classified.reason };

              if (classified.kind === 'timeout') {
                temporaryTimeouts.push(result);
                console.warn(
                  `[SMTP TEST ${current}/${total}] TIMEOUT ${account.username || account.fromEmail || account.label} -> ${account.host}:${account.port} — ${classified.reason}`
                );
                emit({
                  type: 'result',
                  status: 'timeout',
                  index: current,
                  total,
                  account: result,
                  accountId: account.id,
                  label: account.label,
                  fromEmail: account.fromEmail,
                  host: account.host,
                  port: account.port,
                  reason: classified.reason,
                });
              } else {
                invalid.push(result);
                console.error(
                  `[SMTP TEST ${current}/${total}] INVALID ${account.username || account.fromEmail || account.label} -> ${account.host}:${account.port} — ${classified.reason}`
                );
                emit({
                  type: 'result',
                  status: 'invalid',
                  index: current,
                  total,
                  account: result,
                  accountId: account.id,
                  label: account.label,
                  fromEmail: account.fromEmail,
                  host: account.host,
                  port: account.port,
                  reason: classified.reason,
                });
              }
            }
          }

          emit({
            type: 'complete',
            total: accounts.length,
            validCount: valid.length,
            invalidCount: invalid.length,
            timeoutCount: temporaryTimeouts.length,
            valid,
            invalid,
            temporaryTimeouts,
          });
        } catch (error) {
          emit({
            type: 'fatal',
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
