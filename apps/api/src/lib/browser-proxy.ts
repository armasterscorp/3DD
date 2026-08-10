import type { BrowserProxyConfig } from './browser-proxy-types';

export type PlaywrightProxyLaunchOptions = {
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
};

export function validateBrowserProxyConfig(
  config?: BrowserProxyConfig | null
): string | null {
  if (!config?.enabled) {
    return null;
  }

  if (!config.host.trim()) {
    return 'Proxy host is required when proxy is enabled';
  }

  if (!Number.isFinite(config.port) || config.port < 1 || config.port > 65535) {
    return 'Proxy port must be between 1 and 65535';
  }

  return null;
}

export function getBrowserProxyTarget(config?: BrowserProxyConfig | null): string {
  if (!config?.enabled || !config.host.trim()) {
    return 'none';
  }

  return `${config.protocol}://${config.host.trim()}:${config.port}`;
}

export function hasBrowserProxyCredentials(config?: BrowserProxyConfig | null): boolean {
  return Boolean(config?.enabled && (config.username.trim() || config.password));
}

export function buildPlaywrightProxyLaunchOptions(
  config?: BrowserProxyConfig | null
): PlaywrightProxyLaunchOptions {
  if (!config?.enabled || !config.host.trim()) {
    return {};
  }

  const proxy: NonNullable<PlaywrightProxyLaunchOptions['proxy']> = {
    server: getBrowserProxyTarget(config),
  };

  if (config.username.trim()) {
    proxy.username = config.username.trim();
  }

  if (config.password) {
    proxy.password = config.password;
  }

  return { proxy };
}

export function getBrowserProxyDiagnostics(
  config: BrowserProxyConfig | null | undefined,
  helperName: string,
  launchPath: string
): string {
  return config?.enabled
    ? `Proxy enabled | host=${config.host.trim()}:${config.port} | helper=${helperName} | path=${launchPath} | credentials=${hasBrowserProxyCredentials(config) ? 'attached' : 'none'}`
    : `Proxy disabled | helper=${helperName} | path=${launchPath} | credentials=none`;
}
