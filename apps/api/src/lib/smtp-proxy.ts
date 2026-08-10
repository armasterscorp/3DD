import net from 'node:net';
import tls from 'node:tls';
import type { Socket } from 'node:net';

export type SupportedProxyProtocol = 'http:' | 'https:' | 'socks5:' | 'socks5h:';

export function isSupportedProxyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      ['http:', 'https:', 'socks5:', 'socks5h:'] as SupportedProxyProtocol[]
    ).includes(parsed.protocol as SupportedProxyProtocol) && Boolean(parsed.hostname) && Boolean(parsed.port);
  } catch {
    return false;
  }
}

function proxyAuthorizationHeader(parsed: URL): string | undefined {
  if (!parsed.username) return undefined;
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password || '');
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

async function openTcpSocket(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const cleanup = () => {
      socket.removeListener('connect', onConnect);
      socket.removeListener('error', onError);
      socket.removeListener('timeout', onTimeout);
    };
    const onConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.setTimeout(0);
      resolve(socket);
    };
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onTimeout = () => onError(new Error(`Proxy connection timed out after ${timeoutMs} ms`));
    socket.setTimeout(timeoutMs);
    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
  });
}

async function openHttpProxySocket(parsed: URL, timeoutMs: number): Promise<Socket> {
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (!parsed.hostname || !port) throw new Error('Proxy URL is missing host or port');

  if (parsed.protocol === 'https:') {
    return await new Promise<Socket>((resolve, reject) => {
      const socket = tls.connect({ host: parsed.hostname, port, servername: parsed.hostname });
      let settled = false;
      const cleanup = () => {
        socket.removeListener('secureConnect', onConnect);
        socket.removeListener('error', onError);
        socket.removeListener('timeout', onTimeout);
      };
      const onConnect = () => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.setTimeout(0);
        resolve(socket);
      };
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
        reject(error);
      };
      const onTimeout = () => onError(new Error(`HTTPS proxy connection timed out after ${timeoutMs} ms`));
      socket.setTimeout(timeoutMs);
      socket.once('secureConnect', onConnect);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
    });
  }

  return await openTcpSocket(parsed.hostname, port, timeoutMs);
}

function createSocketReader(socket: Socket, timeoutMs: number) {
  let buffer = Buffer.alloc(0);
  let waiter: (() => void) | null = null;
  let ended = false;
  let error: Error | null = null;

  const wake = () => {
    const current = waiter;
    waiter = null;
    current?.();
  };

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    wake();
  };
  const onEnd = () => {
    ended = true;
    wake();
  };
  const onError = (value: Error) => {
    error = value;
    wake();
  };

  socket.on('data', onData);
  socket.once('end', onEnd);
  socket.once('close', onEnd);
  socket.once('error', onError);

  const waitForData = async () => {
    if (buffer.length || ended || error) return;
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        waiter = null;
        reject(new Error(`Proxy handshake timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      waiter = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
    });
  };

  return {
    async readExact(length: number): Promise<Buffer> {
      while (buffer.length < length) {
        if (error) throw error;
        if (ended) throw new Error('Proxy closed the connection during handshake');
        await waitForData();
      }
      const out = buffer.subarray(0, length);
      buffer = buffer.subarray(length);
      return out;
    },
    cleanup() {
      socket.removeListener('data', onData);
      socket.removeListener('end', onEnd);
      socket.removeListener('close', onEnd);
      socket.removeListener('error', onError);
      if (buffer.length) socket.unshift(buffer);
      buffer = Buffer.alloc(0);
    },
  };
}

async function openSocks5Tunnel(parsed: URL, targetHost: string, targetPort: number, timeoutMs: number): Promise<Socket> {
  const proxyPort = Number(parsed.port || 1080);
  if (!parsed.hostname || !proxyPort) throw new Error('SOCKS5 URL is missing host or port');

  const socket = await openTcpSocket(parsed.hostname, proxyPort, timeoutMs);
  const reader = createSocketReader(socket, timeoutMs);

  try {
    const username = parsed.username ? decodeURIComponent(parsed.username) : '';
    const password = parsed.password ? decodeURIComponent(parsed.password) : '';
    const methods = username ? [0x00, 0x02] : [0x00];

    socket.write(Buffer.from([0x05, methods.length, ...methods]));
    const greeting = await reader.readExact(2);
    if (greeting[0] !== 0x05) throw new Error('Invalid SOCKS5 greeting response');
    if (greeting[1] === 0xff) throw new Error('SOCKS5 proxy rejected all authentication methods');

    if (greeting[1] === 0x02) {
      const userBytes = Buffer.from(username, 'utf8');
      const passBytes = Buffer.from(password, 'utf8');
      if (!username) throw new Error('SOCKS5 proxy requires username/password authentication');
      if (userBytes.length > 255 || passBytes.length > 255) throw new Error('SOCKS5 username/password is too long');
      socket.write(Buffer.concat([
        Buffer.from([0x01, userBytes.length]), userBytes,
        Buffer.from([passBytes.length]), passBytes,
      ]));
      const auth = await reader.readExact(2);
      if (auth[0] !== 0x01 || auth[1] !== 0x00) throw new Error('SOCKS5 username/password authentication failed');
    } else if (greeting[1] !== 0x00) {
      throw new Error(`Unsupported SOCKS5 authentication method: ${greeting[1]}`);
    }

    const hostBytes = Buffer.from(targetHost, 'utf8');
    if (hostBytes.length > 255) throw new Error('Target host name is too long for SOCKS5');
    socket.write(Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
      hostBytes,
      Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
    ]));

    const header = await reader.readExact(4);
    if (header[0] !== 0x05) throw new Error('Invalid SOCKS5 CONNECT response');
    if (header[1] !== 0x00) {
      const messages: Record<number, string> = {
        0x01: 'general SOCKS5 failure', 0x02: 'connection not allowed by ruleset',
        0x03: 'network unreachable', 0x04: 'host unreachable', 0x05: 'connection refused',
        0x06: 'TTL expired', 0x07: 'command not supported', 0x08: 'address type not supported',
      };
      throw new Error(`SOCKS5 CONNECT failed: ${messages[header[1]] || `code ${header[1]}`}`);
    }

    if (header[3] === 0x01) await reader.readExact(6);
    else if (header[3] === 0x04) await reader.readExact(18);
    else if (header[3] === 0x03) {
      const length = (await reader.readExact(1))[0];
      await reader.readExact(length + 2);
    } else throw new Error(`Invalid SOCKS5 bind address type: ${header[3]}`);

    reader.cleanup();
    socket.setTimeout(0);
    return socket;
  } catch (error) {
    reader.cleanup();
    socket.destroy();
    throw error;
  }
}

async function openHttpConnectTunnel(parsed: URL, targetHost: string, targetPort: number, timeoutMs: number): Promise<Socket> {
  const socket = await openHttpProxySocket(parsed, timeoutMs);
  const authHeader = proxyAuthorizationHeader(parsed);
  const requestLines = [
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
    `Host: ${targetHost}:${targetPort}`,
    'Proxy-Connection: Keep-Alive',
    'Connection: Keep-Alive',
    ...(authHeader ? [`Proxy-Authorization: ${authHeader}`] : []),
    '', '',
  ];

  try {
    const statusLine = await new Promise<string>((resolve, reject) => {
      let response = '';
      let finished = false;
      const timer = setTimeout(() => finish(new Error(`HTTP CONNECT timed out after ${timeoutMs} ms`)), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
      };
      const finish = (err?: Error, line?: string) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (err) reject(err); else resolve(line || '');
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(new Error('Proxy closed the CONNECT tunnel before replying'));
      const onData = (chunk: Buffer) => {
        response += chunk.toString('latin1');
        if (response.length > 32768) return finish(new Error('Proxy returned an oversized CONNECT response'));
        const end = response.indexOf('\r\n\r\n');
        if (end === -1) return;
        const headerBlock = response.slice(0, end + 4);
        const extra = Buffer.from(response.slice(end + 4), 'latin1');
        if (extra.length) socket.unshift(extra);
        finish(undefined, headerBlock.split('\r\n', 1)[0] || '');
      };
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);
      socket.write(requestLines.join('\r\n'));
    });

    const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/i);
    const code = match ? Number(match[1]) : 0;
    if (code !== 200) throw new Error(code ? `Proxy denied CONNECT: ${statusLine}` : `Invalid CONNECT response: ${statusLine || 'empty response'}`);
    socket.setTimeout(0);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export async function createProxyTunnelSocket(proxyUrl: string, targetHost: string, targetPort: number, timeoutMs = 10_000): Promise<Socket> {
  const parsed = new URL(proxyUrl);
  if (!isSupportedProxyUrl(proxyUrl)) throw new Error('Supported proxy protocols are HTTP, HTTPS, SOCKS5 and SOCKS5H');
  if (parsed.protocol === 'socks5:' || parsed.protocol === 'socks5h:') return await openSocks5Tunnel(parsed, targetHost, targetPort, timeoutMs);
  return await openHttpConnectTunnel(parsed, targetHost, targetPort, timeoutMs);
}

export function configureNodemailerProxy(transporter: any, proxyUrl: string | undefined, timeoutMs = 12_000): void {
  if (!proxyUrl) return;
  const parsed = new URL(proxyUrl);
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    transporter.setupProxy(proxyUrl);
    return;
  }
  if (parsed.protocol !== 'socks5:' && parsed.protocol !== 'socks5h:') throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);

  transporter.getSocket = (
    options: { host: string; port: number },
    callback: (error: Error | null, value?: { connection: Socket }) => void
  ) => {
    createProxyTunnelSocket(proxyUrl, options.host, options.port, timeoutMs)
      .then((socket) => callback(null, { connection: socket }))
      .catch((error) => {
        const proxyError = error instanceof Error ? error : new Error(String(error));
        (proxyError as Error & { code?: string }).code = 'EPROXY';
        callback(proxyError);
      });
  };
}

function decodeChunkedBody(body: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset, 'latin1');
    if (lineEnd < 0) break;
    const size = Number.parseInt(body.subarray(offset, lineEnd).toString('ascii').split(';')[0].trim(), 16);
    if (!Number.isFinite(size)) throw new Error('Invalid chunked HTTP response');
    offset = lineEnd + 2;
    if (size === 0) break;
    if (offset + size > body.length) throw new Error('Incomplete chunked HTTP response');
    chunks.push(body.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}

export async function fetchIpWhoIsThroughProxy(proxyUrl: string, timeoutMs = 12_000): Promise<Record<string, unknown>> {
  const tunnel = await createProxyTunnelSocket(proxyUrl, 'ipwho.is', 443, timeoutMs);
  let secureSocket: tls.TLSSocket | undefined;
  try {
    secureSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const socket = tls.connect({ socket: tunnel, servername: 'ipwho.is' });
      let settled = false;
      const timer = setTimeout(() => fail(new Error(`TLS handshake timed out after ${timeoutMs} ms`)), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener('secureConnect', succeed);
        socket.removeListener('error', fail);
      };
      const succeed = () => { if (!settled) { settled = true; cleanup(); resolve(socket); } };
      const fail = (error: Error) => { if (!settled) { settled = true; cleanup(); socket.destroy(); reject(error); } };
      socket.once('secureConnect', succeed);
      socket.once('error', fail);
    });

    const response = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let finished = false;
      const timer = setTimeout(() => finish(new Error(`Proxy web test timed out after ${timeoutMs} ms`)), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        secureSocket?.removeListener('data', onData);
        secureSocket?.removeListener('end', onEnd);
        secureSocket?.removeListener('error', onError);
      };
      const finish = (err?: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (err) reject(err); else resolve(Buffer.concat(chunks));
      };
      const onData = (chunk: Buffer) => {
        total += chunk.length;
        if (total > 2_000_000) return finish(new Error('Proxy web response exceeded 2 MB'));
        chunks.push(chunk);
      };
      const onEnd = () => finish();
      const onError = (error: Error) => finish(error);
      secureSocket?.on('data', onData);
      secureSocket?.once('end', onEnd);
      secureSocket?.once('error', onError);
      secureSocket?.write('GET / HTTP/1.1\r\nHost: ipwho.is\r\nAccept: application/json\r\nUser-Agent: 3D-SUITEG-Proxy-Test/1.0\r\nConnection: close\r\n\r\n');
    });

    const marker = Buffer.from('\r\n\r\n');
    const headerEnd = response.indexOf(marker);
    if (headerEnd < 0) throw new Error('Invalid HTTP response from IP lookup');
    const headerText = response.subarray(0, headerEnd).toString('latin1');
    const statusLine = headerText.split('\r\n', 1)[0] || '';
    const statusMatch = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/i);
    const status = statusMatch ? Number(statusMatch[1]) : 0;
    if (status < 200 || status >= 400) throw new Error(`IP lookup returned ${statusLine || 'an invalid status'}`);
    let body = response.subarray(headerEnd + marker.length);
    if (/transfer-encoding:\s*chunked/i.test(headerText)) body = decodeChunkedBody(body);
    return JSON.parse(body.toString('utf8')) as Record<string, unknown>;
  } finally {
    secureSocket?.destroy();
    tunnel.destroy();
  }
}
