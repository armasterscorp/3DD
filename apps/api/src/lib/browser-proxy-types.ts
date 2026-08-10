/**
 * Browser proxy configuration model.
 * Used to configure outbound proxy settings for Chromium/Playwright browser automation.
 */
export type BrowserProxyConfig = {
  enabled: boolean;
  protocol: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  password: string;
};
