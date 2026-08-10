import { NextRequest, NextResponse } from 'next/server';
import { cleanInquirySessionId, getInquirySession } from '@/lib/inquiry-browser-store';
import { addInquiryLog, addInquiryResult, getInquiryLicenseId, getInquiryRunState, inquiryCheckpoint, InquiryRunStoppedError } from '@/lib/inquiry-run-store';
import { resolveUserApiKey } from '@/lib/captcha-solver';
import { InquiryCaptchaHandler } from '@/lib/inquiry-captcha-handler';
import {
  getCaptchaSolveTimeoutMs,
  hasFreshCaptchaToken,
  readCaptchaTokenSnapshot,
} from '@/lib/inquiry-captcha-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Profile = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  country?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  jobTitle?: string;
  referralSource?: string;
  location?: string;
  desiredDate?: string;
  subject?: string;
  message?: string;
  additionalFields?: Record<string, string>;
};

type Candidate = {
  index: number;
  text: string;
  href: string;
  score: number;
};

function normalizeTarget(value: unknown): string {
  let raw = String(value || '').trim();
  if (!raw) throw new Error('A domain or URL is required.');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS targets are supported.');
  return url.toString();
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isUnavailableNavigationError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error || '');
  return /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_ABORTED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ERR_PROXY_CONNECTION_FAILED|Timeout \d+ms exceeded|net::ERR_/i.test(text);
}

function shortUnavailableReason(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error || '');
  const match = text.match(/net::(ERR_[A-Z_]+)/i);
  if (match) return match[1].toUpperCase();
  if (/Timeout \d+ms exceeded/i.test(text)) return 'NAVIGATION_TIMEOUT';
  return 'SITE_UNAVAILABLE';
}

async function descriptor(locator: any): Promise<string> {
  return norm([
    await locator.getAttribute('name').catch(() => ''),
    await locator.getAttribute('id').catch(() => ''),
    await locator.getAttribute('placeholder').catch(() => ''),
    await locator.getAttribute('aria-label').catch(() => ''),
    await locator.getAttribute('autocomplete').catch(() => ''),
    await locator.getAttribute('data-label').catch(() => ''),
    await locator.getAttribute('data-name').catch(() => ''),
    await locator.evaluate((el: HTMLInputElement) => {
      const id = el.id;
      const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '' : '';
      const wrapped = el.closest('label')?.textContent || '';
      const described = (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((key) => document.getElementById(key)?.textContent || '')
        .join(' ');
      const previous = el.previousElementSibling?.textContent || '';
      const parent = el.parentElement?.textContent || '';
      const group = el.closest('fieldset, .form-group, .field, .form-field, [class*="field-" i], [class*="input-" i], [class*="control" i]')?.textContent || '';
      return `${explicit} ${wrapped} ${described} ${previous} ${parent.slice(0, 120)} ${group.slice(0, 180)}`;
    }).catch(() => ''),
  ].join(' '));
}


async function fieldSignals(locator: any): Promise<{ raw: string; compact: string; label: string; name: string; id: string; placeholder: string; aria: string; autocomplete: string; type: string }> {
  const values = await locator.evaluate((el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    const id = el.id || '';
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '' : '';
    const wrapped = el.closest('label')?.textContent || '';
    const aria = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const name = el.getAttribute('name') || '';
    const autocomplete = el.getAttribute('autocomplete') || '';
    const dataName = el.getAttribute('data-name') || el.getAttribute('data-field-name') || el.getAttribute('data-label') || '';
    const nearby = el.closest('.form-group, .field, .form-field, [class*="field" i], [class*="control" i]')?.querySelector('label, legend, .label, [class*="label" i]')?.textContent || '';
    return {
      label: `${explicit} ${wrapped} ${nearby}`.trim(),
      name,
      id,
      placeholder,
      aria,
      autocomplete,
      dataName,
      type: (el.getAttribute('type') || el.tagName || '').toLowerCase(),
    };
  }).catch(() => ({ label: '', name: '', id: '', placeholder: '', aria: '', autocomplete: '', dataName: '', type: '' }));

  const compact = norm(`${values.label} ${values.name} ${values.id} ${values.placeholder} ${values.aria} ${values.autocomplete} ${values.dataName}`);
  const raw = norm(`${compact} ${await descriptor(locator)}`);
  return {
    raw,
    compact,
    label: norm(values.label),
    name: norm(values.name),
    id: norm(values.id),
    placeholder: norm(values.placeholder),
    aria: norm(values.aria),
    autocomplete: norm(values.autocomplete),
    type: norm(values.type),
  };
}

function hasAnySignal(signals: { compact: string; name: string; id: string; placeholder: string; aria: string; autocomplete: string; type: string }, patterns: RegExp[]): boolean {
  const values = [signals.name, signals.id, signals.placeholder, signals.aria, signals.autocomplete, signals.compact, signals.type];
  return patterns.some((pattern) => values.some((value) => pattern.test(value)));
}

function friendlyFieldLabel(signals: { label: string; name: string; id: string; placeholder: string; aria: string }, fallback: string): string {
  const value = signals.label || signals.aria || signals.placeholder || signals.name || signals.id || fallback;
  return value.replace(/\s+/g, ' ').trim().slice(0, 100);
}

async function visualActionPause(scope: any, ms = 420): Promise<void> {
  try {
    const page = typeof scope?.page === 'function' ? scope.page() : scope;
    if (page?.waitForTimeout) await page.waitForTimeout(ms);
  } catch {}
}

async function fillTextReliably(field: any, value: string): Promise<boolean> {
  if (!value) return false;
  try {
    await field.fill(value);
  } catch {
    try {
      await field.evaluate((el: HTMLInputElement | HTMLTextAreaElement, next: string) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, next);
        else (el as HTMLInputElement).value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, value);
    } catch {
      return false;
    }
  }

  const current = await field.inputValue().catch(() => '');
  const retained = String(current || '').trim().length > 0;
  if (retained) await visualActionPause(field, 420);
  return retained;
}

async function nearbyFormText(form: any): Promise<string> {
  return norm(await form.evaluate((el: HTMLElement) => {
    const own = el.innerText || el.textContent || '';
    const parent = el.parentElement?.innerText || '';
    const prev = el.previousElementSibling instanceof HTMLElement ? el.previousElementSibling.innerText : '';
    const heading = el.closest('section, article, div')?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent || '';
    return `${heading} ${prev} ${own} ${parent.slice(0, 700)}`;
  }).catch(() => ''));
}

async function scoreForm(form: any): Promise<number> {
  if (!(await form.isVisible().catch(() => false))) return -1;

  // Score the field structure first. Headings/text are useful context, but are deliberately
  // secondary because many real contact widgets have generic or unrelated surrounding copy.
  const emailCount = await form.locator('input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i], input[aria-label*="email" i]').count().catch(() => 0);
  const textareaCount = await form.locator('textarea').count().catch(() => 0);
  const phoneCount = await form.locator('input[type="tel"], input[name*="phone" i], input[name*="mobile" i], input[id*="phone" i], input[id*="tel" i], input[placeholder*="phone" i]').count().catch(() => 0);
  const nameCount = await form.locator('input[name*="name" i], input[id*="name" i], input[placeholder*="name" i], input[aria-label*="name" i], input[name*="nom" i], input[id*="nom" i]').count().catch(() => 0);
  const subjectCount = await form.locator('input[name*="subject" i], input[id*="subject" i], input[placeholder*="subject" i], input[aria-label*="subject" i], input[name*="sujet" i], input[id*="sujet" i]').count().catch(() => 0);
  const messageLikeCount = await form.locator('textarea, input[name*="message" i], input[id*="message" i], input[placeholder*="message" i], input[aria-label*="message" i], input[name*="comment" i], input[id*="comment" i], input[name*="details" i], input[id*="details" i]').count().catch(() => 0);
  const textInputs = await form.locator('input[type="text"], input:not([type])').count().catch(() => 0);
  const selectCount = await form.locator('select').count().catch(() => 0);
  const controls = await form.locator('input:not([type="hidden"]), textarea, select').count().catch(() => 0);
  const submitCount = await form.locator('button[type="submit"], input[type="submit"], input[type="image"], button, [role="button"]').count().catch(() => 0);
  const text = await nearbyFormText(form);
  const structuralMeta = norm(await form.evaluate((el: HTMLElement) => [
    el.getAttribute('action') || '',
    el.getAttribute('id') || '',
    el.getAttribute('class') || '',
    el.getAttribute('name') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('data-form-name') || '',
    el.getAttribute('data-name') || '',
  ].join(' ')).catch(() => ''));

  const intent = /contact|connect with|connect us|get in touch|reach out|reach us|talk to|speak with|inquir|enquir|quote|estimate|assessment|consult|schedule|request|project|sales|help|support|demo|information|get started|start here|book|discuss|tell us|work with us|nous contacter|contactez|communiquer avec|joindre|demande de renseignements|renseignements|demande|soumission|devis|estimation|évaluation|evaluation|consultation|prendre rendez-vous|rendez vous|parler à|parler a|service à la clientèle|service a la clientele|soutien|aide|projet/.test(`${text} ${structuralMeta}`);
  const newsletter = /newsletter|subscribe|mailing list|join our list|email updates|infolettre|abonnez|abonnement|liste de diffusion|courriels promotionnels/.test(text) && textareaCount === 0 && messageLikeCount === 0 && controls <= 3;
  const login = /sign in|log in|password|forgot password|create account|connexion|se connecter|mot de passe|mot de passe oublié|creer un compte|créer un compte/.test(text) && textareaCount === 0;
  const search = /search/.test(text) && controls <= 2;
  const parkingTicket = /parking ticket|parking citation|ticket number|citation number|plate number|license plate|traffic ticket|appeal a ticket|contest a ticket|ticket date and time|violation number/.test(text);

  let score = 0;
  if (emailCount > 0) score += 12;
  if (nameCount > 0) score += 7;
  if (textareaCount > 0 || messageLikeCount > 0) score += 10;
  if (subjectCount > 0) score += 6;
  if (phoneCount > 0) score += 4;
  if (textInputs > 0) score += Math.min(5, textInputs);
  if (selectCount > 0) score += Math.min(3, selectCount);
  if (controls >= 3) score += 4;
  if (submitCount > 0) score += 3;
  // Context/header text is only a bonus now, never a prerequisite.
  if (intent) score += 3;
  if (newsletter) score -= 24;
  if (login) score -= 24;
  if (search) score -= 18;
  if (parkingTicket) score -= 40;

  const classicMessageForm = (textareaCount > 0 || messageLikeCount > 0) && (emailCount > 0 || phoneCount > 0 || nameCount > 0);
  const structuredContactForm = controls >= 3 && emailCount > 0 && (nameCount > 0 || subjectCount > 0) && submitCount > 0;
  const richIdentityForm = controls >= 4 && (emailCount > 0 || phoneCount > 0) && (nameCount > 0 || subjectCount > 0 || selectCount > 0 || intent);
  const quoteAssessmentForm = controls >= 4 && intent && (emailCount > 0 || phoneCount > 0 || textInputs >= 2);
  // Last-resort structural candidate: some React/page-builder forms do not expose an
  // email/textarea semantic until scripts finish, but a multi-field container with a
  // submit control and strong contact intent is still worth inspecting/filling.
  const broadIntentForm = controls >= 3 && submitCount > 0 && intent && (textInputs >= 2 || selectCount >= 1);

  return (classicMessageForm || structuredContactForm || richIdentityForm || quoteAssessmentForm || broadIntentForm) && !parkingTicket ? score : -1;
}

async function findBestForm(page: any): Promise<any | null> {
  let best: any | null = null;
  let bestScore = -1;
  const seen = new Set<string>();

  const consider = async (candidate: any, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const score = await scoreForm(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  };

  // First inspect every literal form, regardless of nearby heading text.
  const forms = page.locator('form');
  const formCount = await forms.count().catch(() => 0);
  for (let i = 0; i < formCount; i += 1) await consider(forms.nth(i), `form:${i}`);

  // Some builders render contact widgets without a real <form>. Look for the smallest
  // visible container around an email/name/message field set and score that container
  // with the exact same structural rules.
  const anchors = page.locator('input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i], input[aria-label*="email" i]');
  const anchorCount = Math.min(await anchors.count().catch(() => 0), 30);
  for (let i = 0; i < anchorCount; i += 1) {
    const anchor = anchors.nth(i);
    if (!(await anchor.isVisible().catch(() => false))) continue;
    const containers = anchor.locator('xpath=ancestor::*[self::section or self::article or self::div or self::main][.//input or .//textarea or .//select]');
    const containerCount = Math.min(await containers.count().catch(() => 0), 6);
    for (let j = 0; j < containerCount; j += 1) {
      const candidate = containers.nth(j);
      const controlCount = await candidate.locator('input:not([type="hidden"]), textarea, select').count().catch(() => 0);
      if (controlCount < 3 || controlCount > 25) continue;
      const fingerprint = await candidate.evaluate((el: HTMLElement) => {
        const path: string[] = [];
        let cur: Element | null = el;
        for (let k = 0; cur && k < 5; k += 1, cur = cur.parentElement) {
          const idx = cur.parentElement ? Array.from(cur.parentElement.children).indexOf(cur) : 0;
          path.push(`${cur.tagName}:${idx}`);
        }
        return path.join('/');
      }).catch(() => `virtual:${i}:${j}`);
      await consider(candidate, `virtual:${fingerprint}`);
      // The nearest qualifying container is usually the widget itself; avoid climbing into
      // a whole page wrapper once we already have a viable structural candidate.
      if (bestScore >= 25) break;
    }
  }

  return bestScore >= 0 ? best : null;
}

async function findBestFormAcrossFrames(page: any): Promise<any | null> {
  // Main document first, then every attached iframe. This catches embedded HubSpot,
  // Jotform, Typeform-style and page-builder forms that never exist in the top DOM.
  const main = await findBestForm(page);
  if (main) return main;

  const frames = typeof page.frames === 'function' ? page.frames() : [];
  for (const frame of frames) {
    if (frame === page.mainFrame?.()) continue;
    const frameUrl = String(frame.url?.() || '');
    if (/recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|doubleclick|googletagmanager/i.test(frameUrl)) continue;
    try {
      const candidate = await findBestForm(frame);
      if (candidate) return candidate;
    } catch {}
  }
  return null;
}

async function waitForHydratedForms(page: any, timeoutMs = 4500): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  let pass = 0;
  while (Date.now() < deadline) {
    const form = await findBestFormAcrossFrames(page);
    if (form) return form;
    // Trigger common lazy renderers/IntersectionObservers without parking at the footer.
    if (pass % 3 === 0) await gentlyRevealLazyContent(page);
    pass += 1;
    await page.waitForTimeout(250);
  }
  return null;
}

function candidateScore(value: string): number {
  const text = norm(value);
  const rules: Array<[RegExp, number]> = [
    [/contact us|contact our team|contact sales|contact support|contact an expert|nous contacter|contactez nous|contactez-nous|communiquez avec nous/, 100],
    [/contact|coordonnées|coordonnees/, 96],
    [/connect with us|connect with our team|connect today|let s connect/, 95],
    [/get in touch|keep in touch|reach out|get ahold of us|nous joindre|joignez nous|joignez-nous|communiquer avec nous/, 94],
    [/talk to (?:an )?expert|talk to sales|talk to us|speak with (?:an )?expert|speak to (?:an )?expert/, 93],
    [/request a quote|request quote|quote request|pricing request|demander (?:une )?soumission|demande de soumission|demander (?:un )?devis|demande de devis/, 92],
    [/get a free quote|get free quote|free quote|get a quote|get quote|instant quote/, 91],
    [/request (?:an )?estimate|get estimate|free estimate|estimate request/, 90],
    [/free assessment|request assessment|schedule assessment|book assessment|sign me up for free assessment/, 89],
    [/schedule (?:a )?(?:call|consultation|meeting|demo)|book (?:a )?(?:call|consultation|meeting|demo)/, 88],
    [/request (?:a )?(?:demo|consultation|meeting|call)|request information|request info/, 87],
    [/inquir|enquir|demande de renseignements|renseignements/, 86],
    [/start (?:a )?project|start your project|new project|discuss your project|project inquiry/, 85],
    [/get started|start here|work with us|how can we help|let s talk|let s chat|let s discuss/, 84],
    [/sales inquiry|business inquiry|general inquiry|customer service|support request/, 83],
    [/request service|service request|request help|get help|need help/, 82],
  ];
  for (const [pattern, score] of rules) if (pattern.test(text)) return score;
  return 0;
}

async function gentlyRevealLazyContent(page: any) {
  try {
    await page.evaluate(async () => {
      const total = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const steps = [0.25, 0.5, 0.75, 1];
      for (const ratio of steps) {
        window.scrollTo(0, total * ratio);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(250);
  } catch {}
}

async function candidateElements(page: any): Promise<Candidate[]> {
  const items = await page.locator('a[href], button, [role="button"], [onclick], input[type="button"], input[type="submit"]').evaluateAll((nodes: Element[]) =>
    nodes.slice(0, 1200).map((el, index) => ({
      index,
      text: ((el as HTMLElement).innerText || el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(),
      href: el instanceof HTMLAnchorElement ? el.href : '',
    }))
  ).catch(() => [] as Array<{ index: number; text: string; href: string }>);

  return items
    .map((item) => ({ index: item.index, text: item.text, href: item.href, score: candidateScore(`${item.text} ${item.href}`) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 32);
}

async function waitForPossibleForm(page: any, timeoutMs = 2200): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const form = await findBestFormAcrossFrames(page);
    if (form) return form;
    await page.waitForTimeout(180);
  }
  return null;
}

async function tryKnownPaths(page: any, baseOrigin: string, tried: Set<string>): Promise<{ contactUrl: string; form: any; discovery: string } | null> {
  const paths = [
    '/contact', '/contact-us', '/contacts', '/get-in-touch', '/connect', '/connect-with-us',
    '/inquiry', '/request-information', '/request-a-quote', '/request-quote', '/quote', '/get-a-quote',
    '/free-quote', '/estimate', '/free-estimate', '/assessment', '/free-assessment', '/consultation',
    '/schedule-a-call', '/talk-to-an-expert', '/get-started', '/start-a-project',
    '/contactus', '/contact_us', '/contact.html', '/contact-us.html', '/contact.php',
    '/support/contact', '/about/contact', '/company/contact', '/sales', '/contact-sales',
    '/request', '/enquiry', '/get-in-touch.html', '/nous-contacter', '/contactez-nous',
  ];
  for (const path of paths) {
    const url = `${baseOrigin}${path}`;
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 6_000 });
      if (response && response.status() >= 400) continue;
      await page.waitForTimeout(350);
      const form = await waitForPossibleForm(page, 900);
      if (form) return { contactUrl: page.url(), form, discovery: `common-path ${path}` };
    } catch {
      // Try the next common path.
    }
  }
  return null;
}

async function findContactPageAndForm(page: any): Promise<{ contactUrl: string; form: any; discovery: string }> {
  // Give client-rendered/lazy forms a real chance before leaving the current page.
  // This is intentionally longer than the old one-shot scan because many builders
  // mount their form a second or two after DOMContentLoaded.
  const existing = await waitForHydratedForms(page, 4_500);
  if (existing) return { contactUrl: page.url(), form: existing, discovery: 'form-on-current-page-or-iframe' };

  const candidates = await candidateElements(page);
  const baseOrigin = new URL(page.url()).origin;
  const tried = new Set<string>();

  for (const candidate of candidates) {
    try {
      if (candidate.href && /^https?:/i.test(candidate.href)) {
        const parsed = new URL(candidate.href);
        if (parsed.origin !== baseOrigin) continue;
        const hrefKey = parsed.href.split('#')[0];
        if (tried.has(hrefKey)) continue;
        tried.add(hrefKey);
        await page.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: 12_000 });
        await page.waitForTimeout(400);
        await gentlyRevealLazyContent(page);
      } else {
        const clickable = page.locator('a[href], button, [role="button"], [onclick], input[type="button"], input[type="submit"]')
          .filter({ hasText: candidate.text }).first();
        if (!(await clickable.isVisible().catch(() => false))) continue;
        await clickable.scrollIntoViewIfNeeded().catch(() => undefined);
        await clickable.click({ timeout: 6_000 });
        await page.waitForTimeout(450);
      }

      const form = await waitForPossibleForm(page, 1800);
      if (form) {
        return { contactUrl: page.url(), form, discovery: candidate.text || candidate.href || 'contact action' };
      }
    } catch {
      // Try the next semantic candidate.
    }
  }

  const commonPath = await tryKnownPaths(page, baseOrigin, tried);
  if (commonPath) return commonPath;

  throw new Error('NO_FORM: No usable Contact, Inquiry, Connect, Assessment, Quote, Estimate, Consultation, or similar form was found.');
}

async function detectCaptcha(page: any, form?: any): Promise<{ detected: boolean; provider?: string }> {
  // CAPTCHA classification must be based on an actual user-visible requirement,
  // not merely on provider scripts/sitekeys/badges existing in the DOM.
  const text = await page.locator('body').innerText().catch(() => '');
  const title = await page.title().catch(() => '');
  const url = String(page.url() || '');
  const challengeText = `${title}\n${text}\n${url}`
    .replace(/protected by\s+recaptcha/ig, '')
    .replace(/recaptcha privacy terms/ig, '')
    .replace(/protected by\s+hcaptcha/ig, '')
    .replace(/protected by\s+cloudflare/ig, '');

  if (/verify (?:that )?you are human|checking (?:your )?browser|complete (?:the )?(?:security|human) check|human verification|attention required|i am not a robot|prove (?:that )?you are human|press and hold|security verification|complete (?:the )?captcha|captcha (?:is )?required|please (?:complete|solve|verify).*captcha/i.test(challengeText)) {
    const provider =
      /cloudflare|turnstile/i.test(challengeText) ? 'Cloudflare challenge' :
      /hcaptcha/i.test(challengeText) ? 'hCaptcha' :
      /recaptcha/i.test(challengeText) ? 'reCAPTCHA' :
      'CAPTCHA / human verification';
    return { detected: true, provider };
  }

  const tokenState = await readCaptchaTokenSnapshot(page);
  if (hasFreshCaptchaToken(tokenState)) {
    return { detected: false };
  }

  // Detect an actual visible checkbox-style challenge below/inside the form.
  // Normal reCAPTCHA/hCaptcha checkbox widgets are roughly a few hundred pixels
  // wide, whereas badges/invisible response frames are tiny or hidden.
  const checkboxFrames = page.locator(
    'iframe[src*="recaptcha/api2/anchor" i], iframe[title*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[title*="hcaptcha" i], iframe[src*="turnstile" i], iframe[src*="challenges.cloudflare.com" i]'
  );
  const frameCount = await checkboxFrames.count().catch(() => 0);
  for (let i = 0; i < frameCount; i += 1) {
    const frame = checkboxFrames.nth(i);
    if (!(await frame.isVisible().catch(() => false))) continue;
    const box = await frame.boundingBox().catch(() => null);
    if (!box) continue;
    const src = String(await frame.getAttribute('src').catch(() => '') || '');
    const titleAttr = String(await frame.getAttribute('title').catch(() => '') || '');

    // Ignore tiny badges/hidden provider plumbing. A visible checkbox/challenge
    // has enough dimensions for a user to interact with it.
    const interactiveWidget = box.width >= 160 && box.height >= 45;
    if (interactiveWidget) {
      return {
        detected: true,
        provider:
          /hcaptcha/i.test(`${src} ${titleAttr}`) ? 'hCaptcha' :
          /cloudflare|turnstile/i.test(`${src} ${titleAttr}`) ? 'Cloudflare Turnstile' :
          'reCAPTCHA',
      };
    }
  }

  return { detected: false };
}

async function findSubmitControl(form: any): Promise<any | null> {
  const direct = form.locator('button[type="submit"], input[type="submit"], input[type="image"]').first();
  if (await direct.isVisible().catch(() => false)) return direct;

  const buttons = form.locator('button, [role="button"], input[type="button"], a[class*="button" i], a[class*="btn" i]');
  const count = await buttons.count().catch(() => 0);
  const pattern = /send|submit|contact|connect|request|quote|estimate|assessment|consult|schedule|book|start|continue|next|get started|talk|speak|inquir|enquir|message|apply|finish|envoyer|soumettre|continuer|suivant|prochaine|poursuivre|réviser|reviser|aperçu|apercu|terminer|finaliser|demander|communiquer/i;
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const text = [
      await button.innerText().catch(() => ''),
      await button.getAttribute('value').catch(() => ''),
      await button.getAttribute('aria-label').catch(() => ''),
      await button.getAttribute('title').catch(() => ''),
    ].join(' ');
    if (pattern.test(text)) return button;
  }
  return null;
}

function commonPresetValue(desc: string, profile: Profile): { value: string; kind: string } | null {
  const d = norm(desc);
  const match = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(d));

  // Deliberately do not auto-answer challenge/security questions. Those stay Review Required.
  if (/captcha|security code|verification code|human verification|what is|plus|minus|multiply|times|sum of|combien font|calcul/.test(d)) return null;

  // Combined/ambiguous locality fields should be explicitly mapped by the user.
  if (/zip city|city zip|postal code city|city postal code|postal city/.test(d)) return null;

  if (match([/\bstreet address\b/, /\bmailing address\b/, /\baddress\b/, /\badresse\b/]) && !/email|courriel|web|website/.test(d)) {
    return profile.address ? { value: profile.address, kind: 'address' } : null;
  }
  if (match([/\bcity\b/, /\btown\b/, /\bville\b/]) && !/zip city/.test(d)) {
    return profile.city ? { value: profile.city, kind: 'city' } : null;
  }
  if (match([/\bstate\b/, /\bprovince\b/, /\bregion\b/, /\brégion\b/])) {
    return profile.state ? { value: profile.state, kind: 'state' } : null;
  }
  if (match([/\bzip\b/, /\bzip code\b/, /\bpostal code\b/, /\bpostcode\b/, /\bcode postal\b/])) {
    return profile.postalCode ? { value: profile.postalCode, kind: 'postalCode' } : null;
  }
  if (match([/\bjob title\b/, /\bposition\b/, /\bjob position\b/, /\brole\b/, /\btitre du poste\b/, /\bfonction\b/])) {
    return profile.jobTitle ? { value: profile.jobTitle, kind: 'jobTitle' } : null;
  }
  if (match([/how did you hear about us/, /how did you find us/, /who referred you/, /referral source/, /referred by/, /comment avez vous entendu parler/, /comment nous avez vous connu/])) {
    return profile.referralSource ? { value: profile.referralSource, kind: 'referralSource' } : null;
  }
  if (match([/\byour location\b/, /\blocation\b/, /\bemplacement\b/, /\blocalisation\b/]) && !/project location|event location/.test(d)) {
    return profile.location ? { value: profile.location, kind: 'location' } : null;
  }
  if (match([/desired date/, /preferred date/, /requested date/, /date desired/, /date souhaitée/, /date souhaitee/, /date préférée/, /date preferee/])) {
    return profile.desiredDate ? { value: profile.desiredDate, kind: 'desiredDate' } : null;
  }
  return null;
}

function normalizedExtraFields(profile: Profile): Array<[string, string]> {
  return Object.entries(profile.additionalFields || {})
    .map(([key, value]) => [norm(String(key)), String(value || '').trim()] as [string, string])
    .filter(([key, value]) => Boolean(key && value));
}

function lookupExtraValue(desc: string, profile: Profile): string {
  const normalized = norm(desc);
  let best = '';
  let bestScore = 0;
  for (const [key, value] of normalizedExtraFields(profile)) {
    const keyTokens = key.split(' ').filter(Boolean);
    const score = keyTokens.reduce((total, token) => total + (normalized.includes(token) ? 1 : 0), 0);
    if ((normalized.includes(key) || key.includes(normalized)) && score < keyTokens.length + 2) {
      if (keyTokens.length + 2 > bestScore) { best = value; bestScore = keyTokens.length + 2; }
    } else if (score > bestScore && score >= Math.min(2, keyTokens.length)) {
      best = value; bestScore = score;
    }
  }
  return best;
}

function phoneCandidates(rawPhone: string, country: string): string[] {
  const raw = String(rawPhone || '').trim();
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  const countryNorm = norm(country || 'united states');
  const isUs = /(^| )(us|usa|united states|united states of america)( |$)/.test(` ${countryNorm} `);
  let national = digits;
  if (isUs && digits.length === 11 && digits.startsWith('1')) national = digits.slice(1);
  const values: string[] = [];
  if (isUs && national.length === 10) {
    values.push(
      national,
      `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`,
      `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`,
      `+1${national}`,
      `+1 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`,
    );
  }
  values.push(raw, digits);
  return Array.from(new Set(values.filter(Boolean)));
}

async function fillPhoneIntelligently(field: any, rawPhone: string, country: string): Promise<boolean> {
  const candidates = phoneCandidates(rawPhone, country);
  if (!candidates.length) return false;
  const attrs = await field.evaluate((el: HTMLInputElement) => ({
    pattern: el.getAttribute('pattern') || '',
    maxLength: el.maxLength,
    minLength: el.minLength,
    autocomplete: el.getAttribute('autocomplete') || '',
  })).catch(() => ({ pattern: '', maxLength: -1, minLength: -1, autocomplete: '' }));

  if (/tel-national/i.test(attrs.autocomplete) || attrs.maxLength === 10) {
    candidates.sort((a, b) => Number(/^\d{10}$/.test(b)) - Number(/^\d{10}$/.test(a)));
  }

  for (const candidate of candidates) {
    try {
      await field.fill(candidate);
      const validity = await field.evaluate((el: HTMLInputElement) => ({
        valid: el.checkValidity(),
        patternMismatch: el.validity.patternMismatch,
        tooLong: el.validity.tooLong,
        tooShort: el.validity.tooShort,
      })).catch(() => ({ valid: true, patternMismatch: false, tooLong: false, tooShort: false }));
      if (validity.valid && !validity.patternMismatch && !validity.tooLong && !validity.tooShort) return true;
    } catch {}
  }
  return false;
}

async function selectSemanticOption(field: any, desired: string, kind: string, required: boolean): Promise<boolean> {
  const options = await field.locator('option').evaluateAll((nodes: HTMLOptionElement[]) =>
    nodes.map((option) => ({ label: (option.textContent || '').trim(), value: option.value, disabled: option.disabled }))
  ).catch(() => [] as Array<{ label: string; value: string; disabled: boolean }>);

  const usable = options.filter((opt: any) => !opt.disabled && norm(opt.label) && !/select|choose|please select|pick one|--/.test(norm(opt.label)));
  const want = norm(desired || '');
  const aliases = kind === 'country' && /united states|usa|u s a|us/.test(want)
    ? ['united states', 'united states of america', 'usa', 'us', 'u s', 'america']
    : want ? [want] : [];

  const exact = usable.find((opt: any) => aliases.some((alias) => norm(opt.label) === norm(alias) || norm(opt.value) === norm(alias)));
  const partial = exact || usable.find((opt: any) => aliases.some((alias) => norm(opt.label).includes(norm(alias)) || norm(alias).includes(norm(opt.label))));

  let chosen = partial;
  if (!chosen && kind === 'subject') {
    chosen = usable.find((opt: any) => /general|general inquiry|other|sales|contact|information|question|service/.test(norm(`${opt.label} ${opt.value}`)));
  }

  // Flexible fallback: when no preset/semantic match exists, choose the first
  // real enabled option. Placeholder entries such as "Select..." or "Choose..."
  // were already removed from `usable` above. This keeps unfamiliar required
  // dropdowns from blocking review while still leaving the final submission
  // behind the user's Submit & Next action.
  if (!chosen && usable.length > 0) chosen = usable[0];
  if (!chosen) return false;

  try {
    await field.selectOption(chosen.value ? { value: chosen.value } : { label: chosen.label });
    return true;
  } catch {
    return false;
  }
}


async function checkRequiredPrivacyConsents(scope: any): Promise<number> {
  const boxes = scope.locator('input[type="checkbox"]');
  const count = await boxes.count().catch(() => 0);
  let checked = 0;
  const consentPattern = /\b(consent|agree|agreement|privacy|data processing|processing of (?:my|the) data|collection.*data|storage.*data|terms and conditions|terms of use|accept|acknowledge|gdpr|personal data|confidentiality|j accepte|je consens|consentement|politique de confidentialité|politique de confidentialite|traitement des données|traitement des donnees|données personnelles|donnees personnelles)\b/i;
  const marketingPattern = /\b(newsletter|marketing|promotional|promotions|offers|special offers|email updates|subscribe|subscription|sms updates|text messages|advertising|communications marketing|commercial messages)\b/i;
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    if (!(await box.isVisible().catch(() => false)) || !(await box.isEnabled().catch(() => false))) continue;
    if (await box.isChecked().catch(() => false)) continue;
    const id = await box.getAttribute('id').catch(() => '');
    let text = '';
    if (id) text += ' ' + String(await scope.locator(`label[for="${String(id).replace(/"/g, '\\"')}"]`).first().innerText().catch(() => ''));
    text += ' ' + String(await box.evaluate((el: any) => {
      const label = el.closest('label');
      const parent = el.parentElement;
      return [label?.innerText || '', parent?.innerText || '', el.getAttribute('aria-label') || '', el.getAttribute('name') || ''].join(' ');
    }).catch(() => ''));
    const required = (await box.getAttribute('required').catch(() => null)) !== null || (await box.getAttribute('aria-required').catch(() => '')) === 'true';
    if ((required || consentPattern.test(text)) && consentPattern.test(text) && !marketingPattern.test(text)) {
      await box.check({ force: true }).catch(async () => { await box.click({ force: true }).catch(() => undefined); });
      if (await box.isChecked().catch(() => false)) {
        checked += 1;
        await visualActionPause(box, 420);
      }
    }
  }
  return checked;
}

async function fillForm(page: any, chosen: any, profile: Profile) {
  const fields = chosen.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
  const count = await fields.count();
  const detected: Array<{ label: string; kind: string; filled: boolean; required: boolean }> = [];
  const extrasSet = new Set<string>();
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  const companyOrName = (profile.company || fullName).trim();
  const defaultCountry = (profile.country || 'United States').trim();

  for (let i = 0; i < count; i += 1) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false)) || !(await field.isEnabled().catch(() => false))) continue;

    const signals = await fieldSignals(field);
    const desc = signals.raw;
    const tag = await field.evaluate((el: HTMLElement) => el.tagName.toLowerCase()).catch(() => 'input');
    const type = (await field.getAttribute('type').catch(() => '')) || tag;
    const required = (await field.getAttribute('required').catch(() => null)) !== null || (await field.getAttribute('aria-required').catch(() => '')) === 'true';
    const fallbackLabel = `${tag}[${i}]`;
    const displayLabel = friendlyFieldLabel(signals, fallbackLabel);

    let value = '';
    let kind = 'other';

    // Strong structural signals first. This prevents parent/form text from making a field
    // look like the wrong type and catches compact names such as contactform_email.
    const emailPatterns = [
      /(^| )(email|e mail|email address|e mail address|mail address)( |$)/,
      /contact ?email|contactform ?email|contact form ?email|your ?email|work ?email|business ?email|customer ?email|reply ?email|courriel|adresse courriel|adresse électronique|adresse electronique/,
    ];
    const firstPatterns = [
      /(^| )(first|first name|firstname|fname|given|given name|givenname|forename)( |$)/,
      /contact first|customer first|your first|prénom|prenom/,
    ];
    const lastPatterns = [
      /(^| )(last|last name|lastname|lname|surname|family|family name|familyname)( |$)/,
      /contact last|customer last|your last|nom de famille|nom famille/,
    ];
    const genericNamePatterns = [
      /(^| )(name|full name|fullname|your name|contact name|contact person|customer name|client name|nom|nom complet|votre nom)( |$)/,
    ];
    const companyPatterns = [/company|organisation|organization|business|employer|company name|business name|entreprise|société|societe|employeur|nom de l entreprise/];

    if (type === 'email' || signals.autocomplete === 'email' || hasAnySignal(signals, emailPatterns)) {
      value = profile.email || '';
      kind = 'email';
    } else if (hasAnySignal(signals, firstPatterns)) {
      value = profile.firstName || '';
      kind = 'firstName';
    } else if (hasAnySignal(signals, lastPatterns)) {
      value = profile.lastName || '';
      kind = 'lastName';
    } else if (hasAnySignal(signals, genericNamePatterns) && !hasAnySignal(signals, companyPatterns) && !/user ?name|username/.test(signals.compact)) {
      value = fullName || companyOrName;
      kind = 'name';
    } else if (type === 'tel' || hasAnySignal(signals, [/phone|telephone|téléphone|mobile|cell|contact number|phone number|tel number|numéro de téléphone|numero de telephone|whatsapp/])) {
      value = profile.phone || '';
      kind = 'phone';
    } else if (hasAnySignal(signals, [/country|nation|pays/])) {
      value = defaultCountry;
      kind = 'country';
    } else if (hasAnySignal(signals, companyPatterns)) {
      value = companyOrName;
      kind = 'company';
    } else if (hasAnySignal(signals, [/subject|topic|reason|regarding|nature of inquiry|inquiry type|enquiry type|how can we help|what can we help|sujet|objet|raison|motif|nature de la demande|type de demande|comment pouvons nous vous aider/])) {
      value = profile.subject || '';
      kind = 'subject';
    } else if (tag === 'textarea' || hasAnySignal(signals, [/message|comment|inquiry|enquiry|description|details|how can we help|tell us|project details|additional information|question|notes|briefly describe|commentaire|demande|détails|details|renseignements supplémentaires|renseignements supplementaires|décrivez|decrivez/])) {
      value = profile.message || '';
      kind = 'message';
    } else {
      const commonPreset = commonPresetValue(desc, profile);
      if (commonPreset) {
        value = commonPreset.value;
        kind = commonPreset.kind;
      } else {
        const extraValue = lookupExtraValue(desc, profile);
        if (extraValue) {
          value = extraValue;
          kind = 'preset';
        }
      }
    }

    let filled = false;
    if (tag === 'select') {
      filled = await selectSemanticOption(field, value, kind, required);
    } else if (value) {
      if (kind === 'phone') {
        filled = await fillPhoneIntelligently(field, value, defaultCountry);
      } else {
        filled = await fillTextReliably(field, value);
      }
    }

    // A few sites initialize or clear controlled inputs after page scripts settle.
    // Retry known identity fields once if they were recognized but did not retain a value.
    if (!filled && value && ['email', 'firstName', 'lastName', 'name', 'company', 'address', 'city', 'state', 'postalCode', 'jobTitle', 'referralSource', 'location', 'desiredDate', 'subject', 'message'].includes(kind) && tag !== 'select') {
      await page.waitForTimeout(80);
      filled = await fillTextReliably(field, value);
    }

    if (required && !filled) extrasSet.add(displayLabel);
    detected.push({ label: displayLabel, kind, filled, required });
  }

  await checkRequiredPrivacyConsents(chosen);

  const captcha = await detectCaptcha(page, chosen);
  if (captcha.detected) {
    return { detected, extras: Array.from(extrasSet), submitVisible: false, fieldCount: count, captchaDetected: true, captchaProvider: captcha.provider || 'CAPTCHA' };
  }

  const submit = await findSubmitControl(chosen);
  const submitVisible = Boolean(submit && await submit.isVisible().catch(() => false));

  await chosen.evaluate((el: HTMLElement) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  }).catch(() => undefined);
  await page.waitForTimeout(650);

  return { detected, extras: Array.from(extrasSet), submitVisible, fieldCount: count, captchaDetected: false };
}

export async function POST(request: NextRequest) {
  let sessionId = '';
  let target = '';
  let licenseId = '';
  let runId = '';
  try {
    const body = await request.json();
    sessionId = cleanInquirySessionId(body.sessionId);
    target = normalizeTarget(body.target);
    const profile: Profile = body.profile || {};
    licenseId = getInquiryLicenseId(request);
    runId = String(body.runId || '').trim() || `run_${Date.now().toString(36)}`;
    await inquiryCheckpoint(licenseId);
    const session = await getInquirySession(sessionId, licenseId, true);
    if (!session) throw new Error('Unable to create Inquiry browser session.');
    session.profile = profile as Record<string, unknown>;
    session.runId = runId;
    session.licenseId = licenseId;
    const { page } = session;
    const savedApiKey = await resolveUserApiKey(licenseId);
    const captchaHandler = savedApiKey ? new InquiryCaptchaHandler(licenseId, runId, savedApiKey) : null;
    const captchaSolveTimeoutMs = getCaptchaSolveTimeoutMs();
    const solvePreloadCaptcha = async () => {
      if (!captchaHandler) return { status: 'unconfigured' as const };
      const existingToken = await readCaptchaTokenSnapshot(page);
      if (hasFreshCaptchaToken(existingToken)) {
        addInquiryLog({ licenseId, runId, level: 'info', message: `reusing solved CAPTCHA token on ${target}` });
        return { handled: true, status: 'solved' as const, solution: 'cached-token' };
      }
      addInquiryLog({ licenseId, runId, level: 'info', message: `attempting to solve pre-load CAPTCHA on ${target}` });
      try {
        const result = await Promise.race([
          captchaHandler.handleCaptcha(page),
          new Promise<{ handled: false; status: 'failed'; error: string }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  handled: false,
                  status: 'failed',
                  error: `timeout after ${Math.round(captchaSolveTimeoutMs / 1000)} seconds`,
                }),
              captchaSolveTimeoutMs
            )
          ),
        ]);
        if (result.status === 'solved') {
          addInquiryLog({ licenseId, runId, level: 'success', message: '✓ CAPTCHA solved' });
        } else if (result.status === 'not_found') {
          addInquiryLog({ licenseId, runId, level: 'info', message: 'no CAPTCHA detected' });
        } else if (result.status === 'failed') {
          addInquiryLog({ licenseId, runId, level: 'warning', message: `⚠ CAPTCHA solving failed, continuing anyway${result.error ? ` (${result.error})` : ''}` });
        }
        return result;
      } catch (error) {
        addInquiryLog({
          licenseId,
          runId,
          level: 'warning',
          message: `⚠ CAPTCHA solving failed, continuing anyway (${error instanceof Error ? error.message : String(error)})`,
        });
        return { handled: false, status: 'failed' as const };
      }
    };

    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      // Live monitor guarantee: let the dashboard render every target's landing
      // page before discovery can immediately navigate elsewhere or classify it.
      await visualActionPause(page, 900);
      await inquiryCheckpoint(licenseId);
      await solvePreloadCaptcha();
    } catch (navigationError) {
      const challenge = await detectCaptcha(page);
      if (challenge.detected) {
        await solvePreloadCaptcha();
      }
      if (isUnavailableNavigationError(navigationError)) {
        addInquiryResult({ licenseId, runId, sessionId, status: 'failed', target, contactUrl: page.url() || target, reason: shortUnavailableReason(navigationError), values: profile as Record<string, unknown> });
        return NextResponse.json({
          success: true,
          classification: 'site_unavailable',
          target,
          contactUrl: page.url() || target,
          currentUrl: page.url() || target,
          unavailableReason: shortUnavailableReason(navigationError),
          captchaDetected: false,
          detected: [], extras: [], submitVisible: false, fieldCount: 0,
        });
      }
      throw navigationError;
    }
    await page.waitForTimeout(400);
    await inquiryCheckpoint(licenseId);

    const pageCaptcha = await detectCaptcha(page);
    if (pageCaptcha.detected) {
      await solvePreloadCaptcha();
    }

    await inquiryCheckpoint(licenseId);
    let discovery;
    try {
      discovery = await findContactPageAndForm(page);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.startsWith('NO_FORM:')) {
        addInquiryResult({ licenseId, runId, sessionId, status: 'failed', target, contactUrl: page.url(), reason: text.replace(/^NO_FORM:\s*/, ''), values: profile as Record<string, unknown> });
        // Show the last inspected page briefly before the worker moves on.
        await visualActionPause(page, 1600);
        return NextResponse.json({
          success: true,
          classification: 'no_form',
          target,
          contactUrl: page.url(),
          currentUrl: page.url(),
          noFormReason: text.replace(/^NO_FORM:\s*/, ''),
          captchaDetected: false,
          detected: [], extras: [], submitVisible: false, fieldCount: 0,
        });
      }
      throw error;
    }

    const captcha = await detectCaptcha(page, discovery.form);
    if (captcha.detected) {
      session.targetUrl = target;
      session.contactUrl = discovery.contactUrl;
      session.lastPreparedAt = new Date().toISOString();
      addInquiryResult({ licenseId, runId, sessionId, status: 'captcha', target, contactUrl: discovery.contactUrl, captchaProvider: captcha.provider || 'CAPTCHA', reason: 'CAPTCHA detected on inquiry form', values: profile as Record<string, unknown> });
      await visualActionPause(page, 2200);
      return NextResponse.json({
        success: true,
        classification: 'captcha',
        target,
        contactUrl: discovery.contactUrl,
        currentUrl: page.url(),
        discovery: discovery.discovery,
        captchaDetected: true,
        captchaProvider: captcha.provider || 'CAPTCHA',
        detected: [], extras: [], submitVisible: false, fieldCount: 0,
      });
    }

    await inquiryCheckpoint(licenseId);
    const form = await fillForm(page, discovery.form, profile);
    await inquiryCheckpoint(licenseId);
    if (form.captchaDetected) {
      session.targetUrl = target;
      session.contactUrl = discovery.contactUrl;
      session.lastPreparedAt = new Date().toISOString();
      addInquiryResult({ licenseId, runId, sessionId, status: 'captcha', target, contactUrl: discovery.contactUrl, captchaProvider: form.captchaProvider || 'CAPTCHA', reason: 'CAPTCHA detected after form preparation', values: profile as Record<string, unknown> });
      await visualActionPause(page, 2200);
      return NextResponse.json({
        success: true, classification: 'captcha', target, contactUrl: discovery.contactUrl, currentUrl: page.url(), discovery: discovery.discovery,
        captchaDetected: true, captchaProvider: form.captchaProvider || 'CAPTCHA',
        detected: form.detected || [], extras: form.extras || [], submitVisible: false, fieldCount: form.fieldCount || 0,
      });
    }

    session.targetUrl = target;
    session.contactUrl = discovery.contactUrl;
    session.lastPreparedAt = new Date().toISOString();

    if (Array.isArray(form.extras) && form.extras.length > 0) {
      const reason = `Manual review required: ${form.extras.length} required/unsupported field(s) still need input — ${form.extras.join(', ')}`;
      addInquiryResult({ licenseId, runId, sessionId, status: 'review', target, contactUrl: discovery.contactUrl, reason, values: profile as Record<string, unknown> });
      return NextResponse.json({
        success: true,
        classification: 'review_required',
        reviewRequired: true,
        reviewReason: reason,
        target,
        contactUrl: discovery.contactUrl,
        currentUrl: page.url(),
        discovery: discovery.discovery,
        captchaDetected: false,
        ...form,
      });
    }

    return NextResponse.json({
      success: true,
      classification: 'form_found',
      target,
      contactUrl: discovery.contactUrl,
      currentUrl: page.url(),
      discovery: discovery.discovery,
      captchaDetected: false,
      ...form,
    });
  } catch (error) {
    if (error instanceof InquiryRunStoppedError || (licenseId && getInquiryRunState(licenseId).mode === 'stopped')) {
      return NextResponse.json({ success: false, code: 'RUN_STOPPED', error: error.message }, { status: 409 });
    }
    if (target && isUnavailableNavigationError(error)) {
      try { if (licenseId) addInquiryResult({ licenseId, runId: runId || 'unknown', sessionId, status: 'failed', target, contactUrl: target, reason: shortUnavailableReason(error) }); } catch {}
      return NextResponse.json({
        success: true,
        classification: 'site_unavailable',
        target,
        contactUrl: target,
        currentUrl: target,
        unavailableReason: shortUnavailableReason(error),
        captchaDetected: false,
        detected: [], extras: [], submitVisible: false, fieldCount: 0,
      });
    }
    try {
      if (licenseId && target) addInquiryResult({ licenseId, runId: runId || 'unknown', sessionId, status: 'failed', target, contactUrl: target, reason: error instanceof Error ? error.message : String(error) });
    } catch {}
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
