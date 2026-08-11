import { NextRequest, NextResponse } from 'next/server';
import { cleanInquirySessionId, getInquirySession } from '@/lib/inquiry-browser-store';
import { addInquiryLog, addInquiryResult, getInquiryLicenseId, getInquiryRunState, inquiryCheckpoint, InquiryRunStoppedError } from '@/lib/inquiry-run-store';
import { getUserApiKey } from '@/lib/captcha-solver';
import { InquiryCaptchaHandler } from '@/lib/inquiry-captcha-handler';
import { classifyCaptchaProviderFromText, classifyCaptchaProviderFromIframe, classifyCaptchaProviderFromError, UNKNOWN_CAPTCHA } from '@/lib/captcha-classifier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function visualSubmitPause(page: any, ms = 550): Promise<void> {
  try { await page.waitForTimeout(ms); } catch {}
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function scoreForm(form: any): Promise<number> {
  if (!(await form.isVisible().catch(() => false))) return -1;
  const email = await form.locator('input[type="email"], input[name*="email" i]').count().catch(() => 0);
  const textarea = await form.locator('textarea').count().catch(() => 0);
  const phone = await form.locator('input[type="tel"], input[name*="phone" i]').count().catch(() => 0);
  const controls = await form.locator('input:not([type="hidden"]), textarea, select').count().catch(() => 0);
  const text = norm(await form.innerText().catch(() => ''));
  const intent = /contact|connect|get in touch|talk to|speak with|quote|estimate|assessment|consult|request|inquir|enquir|project|sales|help|support|get started/.test(text);
  if (!(textarea > 0 && (email > 0 || phone > 0 || controls >= 3)) && !(controls >= 4 && intent)) return -1;
  return textarea * 8 + email * 6 + phone * 2 + Math.min(controls, 6) + (intent ? 6 : 0);
}

async function findBestForm(page: any): Promise<any | null> {
  const forms = page.locator('form');
  const count = await forms.count().catch(() => 0);
  let best: any | null = null;
  let bestScore = -1;
  for (let i = 0; i < count; i += 1) {
    const form = forms.nth(i);
    const score = await scoreForm(form);
    if (score > bestScore) { best = form; bestScore = score; }
  }
  return bestScore >= 0 ? best : null;
}

async function findSubmitControl(form: any): Promise<any | null> {
  const direct = form.locator('button[type="submit"], input[type="submit"], input[type="image"]').first();
  if (await direct.isVisible().catch(() => false)) return direct;

  const buttons = form.locator('button, [role="button"], input[type="button"]');
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



async function checkRequiredPrivacyConsents(scope: any): Promise<number> {
  const boxes = scope.locator('input[type="checkbox"]');
  const count = await boxes.count().catch(() => 0);
  let checked = 0;
  const consentPattern = /\b(consent|agree|agreement|privacy|data processing|processing of (?:my|the) data|collection.*data|storage.*data|terms and conditions|terms of use|accept|acknowledge|gdpr|personal data|confidentiality|j accepte|je consens|consentement|politique de confidentialité|politique de confidentialite|traitement des données|traitement des donnees|données personnelles|donnees personnelles)\b/i;
  const marketingPattern = /\b(newsletter|marketing|promotional|promotions|offers|special offers|email updates|subscribe|subscription|sms updates|text messages|advertising|commercial messages)\b/i;
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    if (!(await box.isVisible().catch(() => false)) || !(await box.isEnabled().catch(() => false))) continue;
    if (await box.isChecked().catch(() => false)) continue;
    const text = String(await box.evaluate((el: any) => {
      const label = el.closest('label');
      const parent = el.parentElement;
      let explicit = '';
      if (el.id) explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || '';
      return [explicit, label?.innerText || '', parent?.innerText || '', el.getAttribute('aria-label') || '', el.getAttribute('name') || ''].join(' ');
    }).catch(() => ''));
    const required = (await box.getAttribute('required').catch(() => null)) !== null || (await box.getAttribute('aria-required').catch(() => '')) === 'true';
    if ((required || consentPattern.test(text)) && consentPattern.test(text) && !marketingPattern.test(text)) {
      await box.check({ force: true }).catch(async () => { await box.click({ force: true }).catch(() => undefined); });
      if (await box.isChecked().catch(() => false)) checked += 1;
    }
  }
  return checked;
}

async function countVisibleInvalidRequired(form: any): Promise<number> {
  const fields = form.locator('input, textarea, select');
  const count = await fields.count().catch(() => 0);
  let invalid = 0;
  for (let i = 0; i < count; i += 1) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    const required = (await field.getAttribute('required').catch(() => null)) !== null ||
      (await field.getAttribute('aria-required').catch(() => '')) === 'true';
    if (!required) continue;
    const ok = await field.evaluate((el: any) => {
      try { return typeof el.checkValidity === 'function' ? el.checkValidity() : true; } catch { return true; }
    }).catch(() => true);
    if (!ok) invalid += 1;
  }
  return invalid;
}


async function getFormFillState(form: any): Promise<{ filled: number; total: number }> {
  const fields = form.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
  const count = await fields.count().catch(() => 0);
  let filled = 0;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    total += 1;
    const value = String(await field.inputValue().catch(() => '')).trim();
    if (value) filled += 1;
  }
  return { filled, total };
}

async function pageStillSubmitting(page: any): Promise<boolean> {
  const busy = await page.locator('[aria-busy="true"], button:disabled, input[type="submit"]:disabled, .loading, .loader, .spinner, [class*="loading" i], [class*="spinner" i]').count().catch(() => 0);
  if (busy > 0) return true;
  const text = String(await page.locator('body').innerText().catch(() => ''));
  return /\b(sending|submitting|processing|please wait|loading|envoi|traitement|veuillez patienter)\b/i.test(text);
}
async function detectSubmissionOutcome(page: any, beforeUrl: string, beforeText: string, beforeFilled: number): Promise<{ status: 'submitted' | 'review' | 'captcha'; reason: string; captchaProvider?: string }> {
  const successText = /thank you|thanks for (?:contacting|reaching out)|thank you for your message|we(?:'|’)ll be in touch|we will be in touch|message (?:was |has been )?sent|submission (?:was )?received|we (?:have )?received your|successfully submitted|form (?:was )?submitted|your request has been received|merci(?: de nous avoir contactés| de votre message)?|message (?:a été )?envoyé|nous avons reçu (?:votre|vos)|demande (?:a été )?envoyée|formulaire (?:a été )?(?:envoyé|soumis)|confirmation de (?:votre )?(?:demande|message)/i;
  const successUrl = /(?:thank[-_]?you|thanks|success|submitted|confirmation|merci)(?:[\/?#._-]|$)/i;
  const reviewText = /please (?:complete|fill|select|choose)|required field|this field is required|please review|review your|additional information|more information|required information|champ requis|champ obligatoire|veuillez (?:remplir|sélectionner|choisir|compléter)|veuillez vérifier|informations? supplémentaires?/i;
  const nextAction = /\b(next|continue|review|preview|suivant|continuer|poursuivre|réviser|reviser|aperçu|apercu)\b/i;
  let reviewReason = '';

  // Adaptive observation: poll quickly for the first ~4 seconds. Only keep
  // waiting (up to ~12 seconds total) while the page still looks like it is
  // actively submitting. Fast sites therefore move on immediately.
  let elapsed = 0;
  const hardMax = 12000;
  while (elapsed < hardMax) {
    const delay = elapsed < 4000 ? 250 : 500;
    await page.waitForTimeout(delay);
    elapsed += delay;

    const url = String(page.url?.() || '');
    const bodyText = String(await page.locator('body').innerText().catch(() => ''));

    const captcha = await detectCaptcha(page, page.locator('body'));
    if (captcha.detected) {
      return { status: 'captcha', reason: `CAPTCHA detected after the submit action (${captcha.provider || 'Unknown CAPTCHA / Human Verification'}).`, captchaProvider: captcha.provider || 'Unknown CAPTCHA / Human Verification' };
    }

    // This catches normal inline confirmations plus transient toast/modal text
    // while it is visible during the fast polling window.
    const confirmationUrlAppeared = url !== beforeUrl && successUrl.test(url);
    const confirmationTextAppeared = successText.test(bodyText) && !successText.test(beforeText);
    if (confirmationUrlAppeared || confirmationTextAppeared) {
      return { status: 'submitted', reason: confirmationUrlAppeared ? 'new confirmation URL detected' : 'new submission confirmation message/popup detected' };
    }

    const activeForm = await findBestForm(page);
    if (activeForm) {
      const invalidRequired = await countVisibleInvalidRequired(activeForm);
      const formText = String(await activeForm.innerText().catch(() => ''));
      const control = await findSubmitControl(activeForm);
      let nextLabel = '';
      if (control) {
        nextLabel = [
          await control.innerText().catch(() => ''),
          await control.getAttribute('value').catch(() => ''),
          await control.getAttribute('aria-label').catch(() => ''),
        ].filter(Boolean).join(' ').trim();
      }

      if (invalidRequired > 0) {
        reviewReason = `Manual review required: ${invalidRequired} visible required field(s) remain incomplete after the submit action.`;
      } else if (reviewText.test(formText)) {
        reviewReason = 'Manual review required: the form is still asking for required/additional information after the submit action.';
      } else if (nextLabel && nextAction.test(nextLabel)) {
        reviewReason = `Manual review required: another form step is still present (${nextLabel || 'Next/Continue/Review'}).`;
      } else if (beforeFilled >= 2) {
        const afterState = await getFormFillState(activeForm);
        // Many AJAX forms simply reset the fields after a successful send.
        // Treat a meaningful filled->cleared transition as success only when
        // no visible validation error/next step remains.
        if (afterState.filled <= 1 && afterState.filled < beforeFilled) {
          return { status: 'submitted', reason: 'form values cleared/reset after submission with no validation errors' };
        }
      }
    } else if (beforeFilled >= 2) {
      // A form disappearing after submit is a useful success signal when it
      // had meaningful data before the click and no CAPTCHA/validation state
      // has appeared.
      return { status: 'submitted', reason: 'submitted form disappeared after the final action' };
    }

    if (elapsed >= 4000) {
      const busy = await pageStillSubmitting(page);
      if (!busy) break;
    }
  }

  return { status: 'review', reason: reviewReason || 'Manual review required: no reliable submission confirmation was detected after the final action.' };
}

async function handleBlockingOverlays(page: any): Promise<{ reviewRequired?: string; dismissed: string[] }> {
  const dismissed: string[] = [];

  // Age gates require a user-specific assertion. Do not guess or bypass them;
  // classify them for Review instead of letting the submit click time out.
  const ageGate = page.locator('[id*="ageverify" i], [class*="age-verify" i], [id*="age-gate" i], [class*="age-gate" i], [class*="ageverify" i]').filter({ visible: true }).first();
  if (await ageGate.isVisible().catch(() => false)) {
    return { reviewRequired: 'Manual review required: an age-verification gate is blocking the form.', dismissed };
  }

  // Dismiss only obvious cookie/privacy notice controls. Restrict the search to
  // banner/modal containers so a normal form consent checkbox/button is not clicked.
  const bannerSelectors = [
    '[class*="cookie" i]', '[id*="cookie" i]', '[class*="gdpr" i]', '[id*="gdpr" i]',
    '[class*="privacy-banner" i]', '[id*="privacy-banner" i]', '[class*="consent-banner" i]', '[id*="consent-banner" i]'
  ];
  const actionPattern = /^(?:ok|okay|got it|ok, got it!?|accept|accept all|allow all|agree|i agree|continue|close|dismiss|j'accepte|accepter|tout accepter)$/i;
  for (const selector of bannerSelectors) {
    const banners = page.locator(selector);
    const count = Math.min(await banners.count().catch(() => 0), 12);
    for (let i = 0; i < count; i += 1) {
      const banner = banners.nth(i);
      if (!(await banner.isVisible().catch(() => false))) continue;
      const controls = banner.locator('button, [role="button"], input[type="button"], input[type="submit"], a');
      const c = Math.min(await controls.count().catch(() => 0), 20);
      for (let j = 0; j < c; j += 1) {
        const button = controls.nth(j);
        if (!(await button.isVisible().catch(() => false))) continue;
        const label = [
          await button.innerText().catch(() => ''),
          await button.getAttribute('value').catch(() => ''),
          await button.getAttribute('aria-label').catch(() => ''),
          await button.getAttribute('title').catch(() => ''),
        ].filter(Boolean).join(' ').trim();
        if (!actionPattern.test(label)) continue;
        try {
          await button.click({ timeout: 2500 });
          dismissed.push(label || 'cookie/privacy notice');
          await page.waitForTimeout(250);
          break;
        } catch {}
      }
    }
  }
  return { dismissed };
}

async function detectCaptcha(page: any, form: any): Promise<{ detected: boolean; provider?: string }> {
  const formText = String(await form.innerText().catch(() => ''))
    .replace(/protected by\s+recaptcha/ig, '')
    .replace(/recaptcha privacy terms/ig, '')
    .replace(/protected by\s+hcaptcha/ig, '')
    .replace(/protected by\s+cloudflare/ig, '');
  const bodyText = String(await page.locator('body').innerText().catch(() => ''))
    .replace(/protected by\s+recaptcha/ig, '')
    .replace(/recaptcha privacy terms/ig, '')
    .replace(/protected by\s+hcaptcha/ig, '')
    .replace(/protected by\s+cloudflare/ig, '');

  const challengeText = `${formText}\n${bodyText}`;
  if (/verify (?:that )?you are human|i am not a robot|security check|human verification|prove (?:that )?you are human|complete (?:the )?(?:security|human) check|press and hold|complete (?:the )?captcha|captcha (?:is )?required|captcha validation failed|please (?:complete|solve|verify).*captcha|please check .*captcha|verification required/i.test(challengeText)) {
    // Classify strictly by concrete provider signals; no default fallback to reCAPTCHA.
    return { detected: true, provider: classifyCaptchaProviderFromText(challengeText) };
  }

  // Visible checkbox-style provider widget counts as a blocking CAPTCHA.
  const frames = page.locator(
    'iframe[src*="recaptcha/api2/anchor" i], iframe[title*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[title*="hcaptcha" i], iframe[src*="turnstile" i], iframe[src*="challenges.cloudflare.com" i]'
  );
  const count = await frames.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const frame = frames.nth(i);
    if (!(await frame.isVisible().catch(() => false))) continue;
    const box = await frame.boundingBox().catch(() => null);
    if (!box) continue;
    const src = String(await frame.getAttribute('src').catch(() => '') || '');
    const titleAttr = String(await frame.getAttribute('title').catch(() => '') || '');

    if (box.width >= 160 && box.height >= 45) {
      // Classify strictly by concrete iframe signals; no default fallback to reCAPTCHA.
      return { detected: true, provider: classifyCaptchaProviderFromIframe(`${src} ${titleAttr}`) };
    }
  }

  // Post-submit validation errors are often rendered in red alert/field-error
  // containers. Search visible error-like nodes specifically so a CAPTCHA error
  // is classified before the generic Review Required logic runs.
  const errors = page.locator(
    '[role="alert"], [aria-live="assertive"], .error, .errors, .validation_error, .validation_message, .field-error, .form-error, [class*="error" i], [class*="invalid" i]'
  );
  const errorCount = Math.min(await errors.count().catch(() => 0), 80);
  for (let i = 0; i < errorCount; i += 1) {
    const node = errors.nth(i);
    if (!(await node.isVisible().catch(() => false))) continue;
    const msg = String(await node.innerText().catch(() => '') || '').trim();
    if (!msg) continue;
    if (/captcha|recaptcha|hcaptcha|turnstile|human verification|verify (?:that )?you are human|verification required|security check/i.test(msg)) {
      return { detected: true, provider: classifyCaptchaProviderFromError(msg) };
    }
  }

  return { detected: false };
}

export async function POST(request: NextRequest) {
  let licenseId = '';
  let sessionId = '';
  let runId = '';
  let target = '';
  try {
    const body = await request.json();
    sessionId = cleanInquirySessionId(body.sessionId);
    licenseId = getInquiryLicenseId(request);
    const session = await getInquirySession(sessionId, licenseId, false);
    if (!session) throw new Error('Inquiry browser is not open.');
    runId = String(body.runId || session.runId || '').trim() || `run_${Date.now().toString(36)}`;
    target = String(session.targetUrl || session.contactUrl || session.page.url() || '').trim();
    await inquiryCheckpoint(licenseId);

    const page = session.page;
    const steps: string[] = [];
    let lastLabel = '';

    const saveReview = (reason: string) => {
      const result = addInquiryResult({ licenseId, runId, sessionId, status: 'review', target, contactUrl: page.url(), reason, values: session.profile || {} });
      return NextResponse.json({ success: false, reviewRequired: true, reason, resultId: result.id, steps }, { status: 409 });
    };
    const savedApiKey = getUserApiKey(licenseId);
    const captchaHandler = savedApiKey ? new InquiryCaptchaHandler(licenseId, runId, savedApiKey) : null;

    /**
     * Single-source-of-truth CAPTCHA state machine for a named submit stage.
     *
     * Detects once, logs once, attempts solve if solver is available.
     * Never logs "no CAPTCHA detected" when detection was positive.
     * Returns whether CAPTCHA was detected and whether it was resolved.
     */
    const checkAndHandleCaptchaBeforeSubmit = async (
      stageLabel: string,
      form: any
    ): Promise<{ detected: boolean; provider: string; resolved: boolean }> => {
      const pageUrl = page.url();
      const captchaResult = await detectCaptcha(page, form);

      if (!captchaResult.detected) return { detected: false, provider: '', resolved: false };

      const provider = captchaResult.provider || 'Unknown CAPTCHA / Human Verification';

      if (!captchaHandler) {
        addInquiryLog({
          licenseId, runId, level: 'info',
          message: `CAPTCHA detected on ${stageLabel}: ${pageUrl} (${provider}) — solver not configured, auto-solve skipped`,
        });
        return { detected: true, provider, resolved: false };
      }

      addInquiryLog({
        licenseId, runId, level: 'info',
        message: `CAPTCHA detected on ${stageLabel}: ${pageUrl} (${provider}) — attempting automated solve`,
      });

      try {
        const solveResult = await Promise.race([
          captchaHandler.handleCaptcha(page),
          new Promise<{ handled: false; status: 'failed'; error: string }>((resolve) =>
            setTimeout(() => resolve({ handled: false, status: 'failed', error: 'timeout after 5 seconds' }), 5_000)
          ),
        ]);

        if (solveResult.status === 'solved') {
          addInquiryLog({ licenseId, runId, level: 'success', message: `✓ CAPTCHA solved on ${stageLabel}: ${pageUrl} (${provider})` });
          return { detected: true, provider, resolved: true };
        }

        const disposeReason = solveResult.status === 'not_found'
          ? 'automated solve found no solvable widget'
          : `solve failed: ${(solveResult as any).error || 'unknown error'}`;
        addInquiryLog({
          licenseId, runId, level: 'warning',
          message: `CAPTCHA unresolved on ${stageLabel}: ${pageUrl} (${provider}) — ${disposeReason}`,
        });
        return { detected: true, provider, resolved: false };
      } catch (error) {
        addInquiryLog({
          licenseId, runId, level: 'warning',
          message: `CAPTCHA unresolved on ${stageLabel}: ${pageUrl} (${provider}) — solve error: ${error instanceof Error ? error.message : String(error)}`,
        });
        return { detected: true, provider, resolved: false };
      }
    };

    // Some inquiry forms use Next/Continue -> Review -> Submit. Walk those
    // visible form actions automatically, but stop on CAPTCHA or if the form
    // cannot present another valid action.
    for (let step = 0; step < 6; step += 1) {
      await inquiryCheckpoint(licenseId);
      let chosen = await findBestForm(page);
      if (!chosen) {
        // After an intermediate click the page may still be rendering — give it
        // one short grace period before concluding the form is gone.
        await page.waitForTimeout(1200);
        chosen = await findBestForm(page);
      }
      if (!chosen) {
        // A disappeared form is not enough to claim success; the final outcome
        // still has to be confirmed below or the target is kept for review.
        if (steps.length > 0 && !/next|continue|review|preview|suivant|continuer|poursuivre|réviser|reviser|aperçu|apercu/i.test(lastLabel)) break;
        return saveReview('The form needs manual review because no usable contact/quote form is currently visible after an intermediate step.');
      }

      await checkRequiredPrivacyConsents(chosen);

      const overlayState = await handleBlockingOverlays(page);
      if (overlayState.reviewRequired) return saveReview(overlayState.reviewRequired);

      // Re-discover form after overlay dismissal in case the DOM mutated.
      const activeForm = await findBestForm(page) || chosen;
      const captchaState = await checkAndHandleCaptchaBeforeSubmit('form submission', activeForm);
      if (captchaState.detected && !captchaState.resolved) {
        const result = addInquiryResult({ licenseId, runId, sessionId, status: 'captcha', target, contactUrl: page.url(), captchaProvider: captchaState.provider, reason: `CAPTCHA on form submission (${captchaState.provider}) could not be resolved automatically`, values: session.profile || {} });
        return NextResponse.json({ success: false, captchaDetected: true, captchaProvider: captchaState.provider, error: `CAPTCHA detected (${captchaState.provider}) — unresolved`, resultId: result.id, steps }, { status: 409 });
      }

      // Re-acquire submit control after potential CAPTCHA solve / DOM mutations.
      const submitForm = await findBestForm(page) || activeForm;
      const submit = await findSubmitControl(submitForm);
      if (!submit) {
        await submitForm.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => undefined);
        return saveReview('Manual review required: no recognizable Send / Submit / Next / Continue action was found.');
      }

      const label = [
        await submit.innerText().catch(() => ''),
        await submit.getAttribute('value').catch(() => ''),
        await submit.getAttribute('aria-label').catch(() => ''),
      ].filter(Boolean).join(' ').trim() || 'submit control';
      lastLabel = label;
      steps.push(label);

      const beforeUrl = String(page.url?.() || '');
      const beforeText = String(await page.locator('body').innerText().catch(() => ''));
      const beforeFillState = await getFormFillState(submitForm);

      await inquiryCheckpoint(licenseId);
      await submit.scrollIntoViewIfNeeded().catch(() => undefined);
      await visualSubmitPause(page, 500);
      try {
        await submit.click({ timeout: 5000 });
      } catch (clickError) {
        const message = clickError instanceof Error ? clickError.message : String(clickError);
        if (/intercepts pointer events|not visible|not enabled|timeout/i.test(message)) {
          const overlayRetry = await handleBlockingOverlays(page);
          if (overlayRetry.reviewRequired) return saveReview(overlayRetry.reviewRequired);
          // Re-acquire submit after overlay dismissal before the final retry click.
          const submitAfterOverlay = await findSubmitControl(await findBestForm(page) || submitForm) || submit;
          try {
            await submitAfterOverlay.click({ timeout: 3500 });
          } catch (retryError) {
            const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
            return saveReview(`Manual review required: the final action is blocked by another page element (${retryMessage.split('\n')[0].slice(0, 180)}).`);
          }
        } else {
          return saveReview(`Manual review required: the final action could not be clicked (${message.split('\n')[0].slice(0, 180)}).`);
        }
      }
      // Keep the clicked state visible long enough for the live screenshot feed
      // to show the action, while submission confirmation itself remains adaptive.
      await visualSubmitPause(page, 700);
      await inquiryCheckpoint(licenseId);

      const isIntermediate = /\b(next|continue|review|preview|suivant|continuer|poursuivre|reviser|aperçu|apercu)\b/i.test(label) && !/\b(send|submit|finish|complete|request|apply|envoyer|soumettre|terminer|finaliser)\b/i.test(label);
      if (!isIntermediate) {
        await page.waitForTimeout(1200);
        if (captchaHandler) {
          const postSubmitCaptcha = await captchaHandler.checkPostSubmitCaptcha(page);
          if (postSubmitCaptcha.detected) {
            // Re-use the state machine for post-submit CAPTCHA (uses body as proxy form).
            await checkAndHandleCaptchaBeforeSubmit('post-submit', page.locator('body'));
          }
        }
        // A button label alone is not proof that the form was submitted. Wait
        // for an explicit success/confirmation state. If the site reveals
        // another section or gives no reliable confirmation, keep it for
        // manual review instead of producing a false Success result.
        const outcome = await detectSubmissionOutcome(page, beforeUrl, beforeText, beforeFillState.filled);
        if (outcome.status === 'captcha') {
          const result = addInquiryResult({ licenseId, runId, sessionId, status: 'captcha', target, contactUrl: page.url(), captchaProvider: outcome.captchaProvider || 'Unknown CAPTCHA / Human Verification', reason: outcome.reason, values: session.profile || {} });
          return NextResponse.json({ success: false, captchaDetected: true, captchaProvider: outcome.captchaProvider || 'Unknown CAPTCHA / Human Verification', error: outcome.reason, resultId: result.id, steps }, { status: 409 });
        }
        if (outcome.status === 'review') return saveReview(outcome.reason);

        const result = addInquiryResult({ licenseId, runId, sessionId, status: 'submitted', target, contactUrl: page.url(), reason: outcome.reason, values: session.profile || {} });
        return NextResponse.json({
          success: true,
          confirmed: true,
          confirmation: outcome.reason,
          currentUrl: page.url(),
          submitLabel: label,
          steps,
          submittedValues: session.profile || {},
          resultId: result.id,
          message: `Form submission confirmed after ${steps.length} action${steps.length === 1 ? '' : 's'}: ${steps.join(' -> ')}`,
        });
      }
    }

    return saveReview(`Manual review required: the form did not reach a final Submit/Send action after ${steps.length} step(s).`);
  } catch (error) {
    if (error instanceof InquiryRunStoppedError || (licenseId && getInquiryRunState(licenseId).mode === 'stopped')) {
      return NextResponse.json({ success: false, code: 'RUN_STOPPED', error: error.message }, { status: 409 });
    }
    try {
      if (licenseId && target) addInquiryResult({ licenseId, runId: runId || 'unknown', sessionId, status: 'failed', target, contactUrl: target, reason: error instanceof Error ? error.message : String(error) });
    } catch {}
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
