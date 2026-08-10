import test from 'node:test';
import assert from 'node:assert/strict';

import { CaptchaStore } from './captcha-store';
import {
  getUserApiKey,
  resolveUserApiKey,
  setUserApiKey,
} from './captcha-solver';
import {
  getCaptchaApiKeyFromEnv,
  getCaptchaSolveTimeoutMs,
  getInquiryPhaseTimeoutMs,
  hasFreshCaptchaToken,
  maskSecret,
  readCaptchaTokenSnapshot,
} from './inquiry-captcha-utils';

test('captcha env helpers honor configured bounds and fallbacks', () => {
  assert.equal(
    getCaptchaSolveTimeoutMs({ INQUIRY_CAPTCHA_SOLVE_TIMEOUT_MS: '70000' }),
    70_000
  );
  assert.equal(
    getCaptchaSolveTimeoutMs({ INQUIRY_CAPTCHA_SOLVE_TIMEOUT_MS: '1000' }),
    5_000
  );
  assert.equal(
    getInquiryPhaseTimeoutMs('prepare', { INQUIRY_PREPARE_TIMEOUT_MS: '999999' }),
    240_000
  );
  assert.equal(
    getInquiryPhaseTimeoutMs('submit', { INQUIRY_SUBMIT_TIMEOUT_MS: '15000' }),
    20_000
  );
});

test('captcha env helper resolves provider key aliases', () => {
  assert.equal(
    getCaptchaApiKeyFromEnv({ TWO_CAPTCHA_API_KEY: 'abc123' }),
    'abc123'
  );
  assert.equal(
    getCaptchaApiKeyFromEnv({ CAPTCHA_API_KEY: 'fallback-key' }),
    'fallback-key'
  );
  assert.equal(getCaptchaApiKeyFromEnv({}), null);
});

test('captcha token freshness prefers recent solved tokens', () => {
  const now = 1_000_000;
  assert.equal(
    hasFreshCaptchaToken(
      {
        recaptchaResponse: 'token-1',
        solvedAt: now - 60_000,
      },
      now,
      110_000
    ),
    true
  );
  assert.equal(
    hasFreshCaptchaToken(
      {
        turnstileResponse: 'token-2',
        solvedAt: now - 120_000,
      },
      now,
      110_000
    ),
    false
  );
});

test('maskSecret only exposes the tail of sensitive values', () => {
  assert.equal(maskSecret('1234567890abcdef'), '************cdef');
  assert.equal(maskSecret('abcd'), '****');
});

test('resolveUserApiKey prefers in-memory then persisted store', async () => {
  const userId = `user-${Date.now()}-memory`;
  setUserApiKey(userId, 'memory-key');
  assert.equal(await resolveUserApiKey(userId), 'memory-key');
  assert.equal(getUserApiKey(userId), 'memory-key');

  const storedUserId = `user-${Date.now()}-stored`;
  await CaptchaStore.saveCaptchaConfig(storedUserId, 'stored-key');
  assert.equal(await resolveUserApiKey(storedUserId), 'stored-key');
});

test('readCaptchaTokenSnapshot reads known response fields from page evaluate', async () => {
  const page = {
    async evaluate<T>(fn: () => T) {
      const previousDocument = (globalThis as any).document;
      const fakeNode = (value: string) => ({ value, textContent: value });
      (globalThis as any).document = {
        documentElement: {
          getAttribute(name: string) {
            return name === 'data-3d-suite-captcha-solved-at' ? '1234' : null;
          },
        },
        body: {
          getAttribute() {
            return null;
          },
        },
        querySelector(selector: string) {
          if (selector === '#g-recaptcha-response') return fakeNode('recaptcha-token');
          if (selector === 'textarea[name="h-captcha-response"]') return fakeNode('');
          if (selector === 'input[name="cf-turnstile-response"]') return fakeNode('');
          return null;
        },
      };

      try {
        return fn();
      } finally {
        (globalThis as any).document = previousDocument;
      }
    },
  };

  const snapshot = await readCaptchaTokenSnapshot(page);
  assert.equal(snapshot.recaptchaResponse, 'recaptcha-token');
  assert.equal(snapshot.solvedAt, 1234);
});
