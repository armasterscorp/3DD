import { chromium, type Browser } from 'playwright';

export type DolphinLaunchResult = {
  browser: Browser;
  profileId: number;
  endpoint: string;
};

let cachedBrowser: Browser | null = null;
let cachedProfileId: number | null = null;
let cachedEndpoint: string | null = null;

function getLocalApiBase(): string {
  return (process.env.DOLPHIN_LOCAL_API || 'http://localhost:3001').replace(/\/$/, '');
}

export function isDolphinEnabled(): boolean {
  return (process.env.DOLPHIN_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function getProfileId(profileIdOverride?: string | number): number {
  const raw = String(profileIdOverride ?? process.env.DOLPHIN_PROFILE_ID ?? '').trim();
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    throw new Error('DOLPHIN_PROFILE_ID must be set to a valid positive browser profile ID');
  }
  return id;
}

function extractEndpoint(payload: any): string | null {
  const port =
    payload?.automation?.port ??
    payload?.automationPort ??
    payload?.port;

  const rawCandidates = [
    payload?.automation?.wsEndpoint,
    payload?.automation?.ws_endpoint,
    payload?.automation?.endpoint,
    payload?.wsEndpoint,
    payload?.ws_endpoint,
    payload?.endpoint,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const raw of rawCandidates) {
    const value = raw.trim();

    if (
      value.startsWith('ws://') ||
      value.startsWith('wss://') ||
      value.startsWith('http://') ||
      value.startsWith('https://')
    ) {
      return value;
    }

    if (value.startsWith('/devtools/')) {
      if (typeof port === 'number' || (typeof port === 'string' && port.trim())) {
        return `ws://127.0.0.1:${port}${value}`;
      }
    }

    if (/^\d+$/.test(value)) {
      return `http://127.0.0.1:${value}`;
    }
  }

  if (typeof port === 'number' || (typeof port === 'string' && port.trim())) {
    return `http://127.0.0.1:${port}`;
  }

  return null;
}

async function connectToEndpoint(
  profileId: number,
  endpoint: string
): Promise<DolphinLaunchResult> {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 60000 });

  cachedBrowser = browser;
  cachedProfileId = profileId;
  cachedEndpoint = endpoint;

  browser.on('disconnected', () => {
    console.log(`DOLPHIN | disconnected from profile ${profileId}`);
    cachedBrowser = null;
    cachedProfileId = null;
    cachedEndpoint = null;
  });

  console.log(`DOLPHIN | Playwright connected to profile ${profileId}`);

  return { browser, profileId, endpoint };
}

export async function launchDolphinBrowser(
  profileIdOverride?: string | number
): Promise<DolphinLaunchResult> {
  const profileId = getProfileId(profileIdOverride);

  if (
    cachedBrowser &&
    cachedProfileId === profileId &&
    cachedBrowser.isConnected()
  ) {
    console.log(
      `DOLPHIN | reusing existing connected profile ${profileId} | endpoint=${cachedEndpoint}`
    );

    return {
      browser: cachedBrowser,
      profileId,
      endpoint: cachedEndpoint || '',
    };
  }

  const base = getLocalApiBase();
  const url = `${base}/v1.0/browser_profiles/${profileId}/start`;

  console.log(`DOLPHIN | starting profile ${profileId} via ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      automation: true,
      headless: false,
      noTabs: true,
    }),
  });

  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  console.log(
    `DOLPHIN | raw automation response=${JSON.stringify(payload?.automation ?? payload)}`
  );

  if (!response.ok) {
    const alreadyRunning =
      response.status === 500 &&
      (
        raw.includes('E_BROWSER_RUN_DUPLICATE') ||
        raw.toLowerCase().includes('already running')
      );

    if (alreadyRunning && cachedBrowser && cachedBrowser.isConnected()) {
      console.log(
        `DOLPHIN | profile ${profileId} is already running; reusing cached connection`
      );

      return {
        browser: cachedBrowser,
        profileId,
        endpoint: cachedEndpoint || '',
      };
    }

    throw new Error(
      `Dolphin profile start failed: HTTP ${response.status} ${raw || response.statusText}`
    );
  }

  const endpoint = extractEndpoint(payload);
  if (!endpoint) {
    throw new Error(
      `Dolphin started profile ${profileId} but did not return an automation endpoint: ${raw}`
    );
  }

  console.log(`DOLPHIN | automation endpoint=${endpoint}`);

  return connectToEndpoint(profileId, endpoint);
}



export async function clearDolphinBrowserSession(browser: Browser): Promise<void> {
  try {
    const contexts = browser.contexts();

    for (const context of contexts) {
      await context.clearCookies().catch(() => undefined);

      for (const page of context.pages()) {
        await page
          .evaluate(async () => {
            try {
              window.localStorage.clear();
            } catch {}

            try {
              window.sessionStorage.clear();
            } catch {}

            try {
              if ('caches' in window) {
                const cacheKeys = await caches.keys();
                await Promise.all(cacheKeys.map((key) => caches.delete(key)));
              }
            } catch {}

            try {
              if (window.indexedDB && indexedDB.databases) {
                const databases = await indexedDB.databases();
                for (const database of databases) {
                  if (database.name) {
                    indexedDB.deleteDatabase(database.name);
                  }
                }
              }
            } catch {}
          })
          .catch(() => undefined);
      }
    }

    console.log(
      `DOLPHIN | cleared cookies and browser storage for ${contexts.length} context(s)`
    );
  } catch (error) {
    console.error(
      'DOLPHIN | failed to clear browser session data |',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function stopDolphinProfile(profileId: number): Promise<void> {
  const base = getLocalApiBase();
  const url = `${base}/v1.0/browser_profiles/${profileId}/stop`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const text = await response.text();
    console.log(`DOLPHIN | stop profile ${profileId} | HTTP ${response.status} | ${text}`);
  } catch (error) {
    console.error(
      `DOLPHIN | failed to stop profile ${profileId} |`,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    cachedBrowser = null;
    cachedProfileId = null;
    cachedEndpoint = null;
  }
}
