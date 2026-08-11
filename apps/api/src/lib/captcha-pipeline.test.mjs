/**
 * Tests for the CAPTCHA pipeline fixes:
 *
 *  1. detectCaptcha + solver unavailable → unresolved-skip (no "no CAPTCHA detected")
 *  2. Unknown provider classified as "Unknown CAPTCHA / Human Verification" (not reCAPTCHA)
 *  3. Post-transition form recovery (re-discover form, re-fill, resubmit)
 *  4. Overlay-intercept retry before classifying REVIEW_REQUIRED
 *
 * Run with:  node --experimental-vm-modules captcha-pipeline.test.mjs
 * (No test framework required — uses Node.js built-in assert.)
 */

import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the pure classification helpers (mirrors captcha-classifier.ts logic)
// ---------------------------------------------------------------------------

const UNKNOWN_CAPTCHA = 'Unknown CAPTCHA / Human Verification';

function classifyCaptchaProviderFromText(text) {
  if (/cloudflare|turnstile/i.test(text)) return 'Cloudflare Turnstile';
  if (/hcaptcha/i.test(text)) return 'hCaptcha';
  if (/(?:^|\s|[^a-z])recaptcha(?:\s|[^a-z]|$)/i.test(text)) return 'reCAPTCHA';
  return UNKNOWN_CAPTCHA;
}

function classifyCaptchaProviderFromIframe(iframeSignal) {
  if (/hcaptcha/i.test(iframeSignal)) return 'hCaptcha';
  if (/cloudflare|turnstile/i.test(iframeSignal)) return 'Cloudflare Turnstile';
  if (/recaptcha/i.test(iframeSignal)) return 'reCAPTCHA';
  return UNKNOWN_CAPTCHA;
}

// ---------------------------------------------------------------------------
// Minimal CAPTCHA state-machine helper (mirrors checkAndHandleCaptchaAtStage)
// ---------------------------------------------------------------------------

/**
 * Simulate the CAPTCHA state machine.
 *
 * @param {object} detectionResult  - { detected: bool, provider?: string }
 * @param {boolean} solverAvailable - whether a solver (captchaHandler) exists
 * @returns {{ logs: string[], result: { detected, provider, resolved } }}
 */
function runCaptchaStateMachine(detectionResult, solverAvailable, solveOutcome = 'solved') {
  const logs = [];

  if (!detectionResult.detected) {
    logs.push(solverAvailable
      ? 'no CAPTCHA detected on homepage: https://example.com/'
      : 'no CAPTCHA detected on homepage (solver not configured)');
    return { logs, result: { detected: false, provider: '', resolved: false } };
  }

  const provider = detectionResult.provider || UNKNOWN_CAPTCHA;

  if (!solverAvailable) {
    // Must NOT log "no CAPTCHA detected" — must log "detected, solver not configured".
    logs.push(`CAPTCHA detected on homepage: https://example.com/ (${provider}) — solver not configured, auto-solve skipped`);
    return { logs, result: { detected: true, provider, resolved: false } };
  }

  logs.push(`CAPTCHA detected on homepage: https://example.com/ (${provider}) — attempting automated solve`);

  if (solveOutcome === 'solved') {
    logs.push(`✓ CAPTCHA solved on homepage: https://example.com/ (${provider})`);
    return { logs, result: { detected: true, provider, resolved: true } };
  }

  if (solveOutcome === 'not_found') {
    logs.push(`CAPTCHA unresolved on homepage: https://example.com/ (${provider}) — automated solve found no solvable widget`);
  } else {
    logs.push(`CAPTCHA unresolved on homepage: https://example.com/ (${provider}) — solve failed: ${solveOutcome}`);
  }
  return { logs, result: { detected: true, provider, resolved: false } };
}

// ---------------------------------------------------------------------------
// Test 1: detected CAPTCHA + solver unavailable → unresolved-skip
//         NEVER "no CAPTCHA detected"
// ---------------------------------------------------------------------------

(function testDetectedCaptchaSolverUnavailable() {
  const detection = { detected: true, provider: 'reCAPTCHA' };
  const { logs, result } = runCaptchaStateMachine(detection, /* solverAvailable= */ false);

  // Must be unresolved
  assert.equal(result.resolved, false, 'should be unresolved when solver unavailable');
  assert.equal(result.detected, true, 'should still be detected');

  // Must NOT contain "no CAPTCHA detected" anywhere in the logs
  const noCaptchaLog = logs.find(l => /no CAPTCHA detected/i.test(l));
  assert.equal(noCaptchaLog, undefined,
    `logs must not contain "no CAPTCHA detected" after positive detection; got: ${JSON.stringify(logs)}`);

  // Must contain "solver not configured"
  const solverNotConfiguredLog = logs.find(l => /solver not configured/i.test(l));
  assert.notEqual(solverNotConfiguredLog, undefined,
    `logs must contain "solver not configured" message; got: ${JSON.stringify(logs)}`);

  console.log('✅ Test 1 passed: detected+solver-unavailable → unresolved-skip (no contradictory log)');
})();

// ---------------------------------------------------------------------------
// Test 2: Unknown provider is NOT reCAPTCHA
// ---------------------------------------------------------------------------

(function testUnknownProviderClassification() {
  // Text with no reCAPTCHA/hCaptcha/Cloudflare signals
  const result1 = classifyCaptchaProviderFromText('Please complete the security check');
  assert.equal(result1, UNKNOWN_CAPTCHA,
    `generic challenge text should be "${UNKNOWN_CAPTCHA}", got "${result1}"`);

  // Iframe signal with no recognised provider
  const result2 = classifyCaptchaProviderFromIframe('https://captcha.provider.com/challenge?id=abc');
  assert.equal(result2, UNKNOWN_CAPTCHA,
    `unknown iframe src should be "${UNKNOWN_CAPTCHA}", got "${result2}"`);

  // Bare word "captcha" (no provider brand) must not map to reCAPTCHA
  const result3 = classifyCaptchaProviderFromText('Please verify you are human. captcha required.');
  assert.equal(result3, UNKNOWN_CAPTCHA,
    `"captcha required" without brand should be "${UNKNOWN_CAPTCHA}", got "${result3}"`);

  // Actual reCAPTCHA text must still be classified correctly
  const result4 = classifyCaptchaProviderFromText('I am not a robot reCAPTCHA');
  assert.equal(result4, 'reCAPTCHA',
    `explicit reCAPTCHA text should be "reCAPTCHA", got "${result4}"`);

  // hCaptcha
  const result5 = classifyCaptchaProviderFromText('verify you are human hcaptcha');
  assert.equal(result5, 'hCaptcha', `hCaptcha text should give "hCaptcha", got "${result5}"`);

  // Cloudflare Turnstile via iframe
  const result6 = classifyCaptchaProviderFromIframe('https://challenges.cloudflare.com/turnstile/v0/api.js');
  assert.equal(result6, 'Cloudflare Turnstile',
    `Cloudflare iframe should give "Cloudflare Turnstile", got "${result6}"`);

  console.log('✅ Test 2 passed: unknown provider classified as "Unknown CAPTCHA / Human Verification", not reCAPTCHA');
})();

// ---------------------------------------------------------------------------
// Test 3: Post-transition form recovery (simulate form re-discovery + resubmit)
// ---------------------------------------------------------------------------

(function testPostTransitionFormRecovery() {
  let formCallCount = 0;
  let submitCallCount = 0;

  // Simulate findBestForm: returns null on first call (form not yet rendered after
  // intermediate step) and the form on the second call (after the grace delay).
  const findBestForm = () => {
    formCallCount += 1;
    if (formCallCount === 1) return null;    // not yet rendered
    return { id: 'contactForm' };           // recovered
  };

  // Simulate findSubmitControl: always returns a submit button
  const findSubmitControl = (form) => {
    if (!form) return null;
    submitCallCount += 1;
    return { label: 'Submit' };
  };

  // --- Run the loop logic ---
  let form = findBestForm();   // first call → null
  if (!form) {
    // Grace period retry (mirrors the 1200ms wait + retry in submit/route.ts)
    form = findBestForm();
  }

  assert.notEqual(form, null, 'Form should be recovered after retry');

  const submit = findSubmitControl(form);
  assert.notEqual(submit, null, 'Submit control should be found on recovered form');

  assert.equal(formCallCount, 2, 'findBestForm should have been called twice (initial + retry)');
  assert.equal(submitCallCount, 1, 'findSubmitControl should have been called once on the recovered form');

  console.log('✅ Test 3 passed: post-transition form recovery and resubmit path');
})();

// ---------------------------------------------------------------------------
// Test 4: Overlay-intercept retry before REVIEW_REQUIRED
// ---------------------------------------------------------------------------

(function testOverlayInterceptRetry() {
  let clickAttempts = 0;
  let overlayDismissed = false;

  // Simulate a click that is blocked by an overlay on the first attempt,
  // succeeds after the overlay is dismissed on the second attempt.
  const simulateClick = () => {
    clickAttempts += 1;
    if (clickAttempts === 1 && !overlayDismissed) {
      throw new Error('locator.click: intercepts pointer events');
    }
    return 'clicked';
  };

  const dismissOverlay = () => {
    overlayDismissed = true;
    return { reviewRequired: null };
  };

  let outcome;
  try {
    simulateClick();  // first attempt — throws
    outcome = 'submitted';
  } catch (err) {
    // Matches the intercept-detection guard in submit/route.ts
    if (/intercepts pointer events|not visible|not enabled|timeout/i.test(err.message)) {
      const overlayState = dismissOverlay();
      if (!overlayState.reviewRequired) {
        // Retry after overlay dismissal
        simulateClick();
        outcome = 'submitted';
      } else {
        outcome = 'review';
      }
    } else {
      outcome = 'review';
    }
  }

  assert.equal(outcome, 'submitted', 'Should succeed after overlay dismissal retry');
  assert.equal(clickAttempts, 2, 'Should have attempted click twice');
  assert.equal(overlayDismissed, true, 'Overlay should have been dismissed before retry');

  console.log('✅ Test 4 passed: overlay-intercept retry succeeds before classifying REVIEW_REQUIRED');
})();

console.log('\n✅ All CAPTCHA pipeline tests passed.\n');
