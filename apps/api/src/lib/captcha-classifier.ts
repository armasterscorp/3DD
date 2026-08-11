/**
 * Strict CAPTCHA provider classification utilities.
 *
 * Rules:
 *   - Google-specific signals  => reCAPTCHA
 *   - hCaptcha-specific signals => hCaptcha
 *   - Cloudflare / Turnstile   => Cloudflare Turnstile
 *   - Otherwise                => Unknown CAPTCHA / Human Verification
 *
 * There is no default fallback to reCAPTCHA.  An unknown signal is always
 * classified as "Unknown CAPTCHA / Human Verification".
 */

export const UNKNOWN_CAPTCHA = 'Unknown CAPTCHA / Human Verification';

/**
 * Classify CAPTCHA provider from text content (page/form text, body text, URL).
 *
 * @param text - Combined challenge text to classify against.
 * @returns Provider label string.
 */
export function classifyCaptchaProviderFromText(text: string): string {
  if (/cloudflare|turnstile/i.test(text)) return 'Cloudflare Turnstile';
  if (/hcaptcha/i.test(text)) return 'hCaptcha';
  // Use a word-boundary-like guard so "recaptcha" matches but stray substrings
  // that merely contain the letters do not incorrectly classify unknown providers.
  if (/(?:^|\s|[^a-z])recaptcha(?:\s|[^a-z]|$)/i.test(text)) return 'reCAPTCHA';
  return UNKNOWN_CAPTCHA;
}

/**
 * Classify CAPTCHA provider from an iframe src / title attribute string.
 *
 * @param iframeSignal - Combined src + title string of the iframe element.
 * @returns Provider label string.
 */
export function classifyCaptchaProviderFromIframe(iframeSignal: string): string {
  if (/hcaptcha/i.test(iframeSignal)) return 'hCaptcha';
  if (/cloudflare|turnstile/i.test(iframeSignal)) return 'Cloudflare Turnstile';
  if (/recaptcha/i.test(iframeSignal)) return 'reCAPTCHA';
  return UNKNOWN_CAPTCHA;
}

/**
 * Classify CAPTCHA provider from a validation error message node text.
 *
 * @param errorMessage - Text of the visible error/alert node.
 * @returns Provider label string.
 */
export function classifyCaptchaProviderFromError(errorMessage: string): string {
  if (/hcaptcha/i.test(errorMessage)) return 'hCaptcha';
  if (/cloudflare|turnstile/i.test(errorMessage)) return 'Cloudflare Turnstile';
  if (/recaptcha/i.test(errorMessage)) return 'reCAPTCHA';
  return UNKNOWN_CAPTCHA;
}
