const LEGAL_CONSENT_PATTERN = /\b(terms?|conditions?|privacy|policy|agree|consent|authorize|authorise|accept|gdpr)\b/i;
const MARKETING_PATTERN = /\b(communications?|sms|email updates?|opt[ -]?in|marketing|newsletter|promotional|promotions|offers?|special offers|subscribe|subscription|text messages|advertising|commercial messages)\b/i;

export type ConsentCheckboxClassification = {
  required: boolean;
  legalConsent: boolean;
  marketingOnly: boolean;
  shouldCheck: boolean;
  checkKind: 'required' | 'optional_legal' | 'optional_marketing' | 'skip';
};

export type ConsentCheckboxSummary = {
  checkboxesFound: number;
  requiredCheckedCount: number;
  optionalCheckedCount: number;
  uncheckedRequiredRemaining: number;
  unresolvedRequired: Array<{ label: string; selector: string }>;
};

export function classifyConsentCheckbox(input: {
  text: string;
  required: boolean;
  alwaysCheckOptionalMarketing?: boolean;
}): ConsentCheckboxClassification {
  const text = String(input.text || '').replace(/\s+/g, ' ').trim();
  const legalConsent = LEGAL_CONSENT_PATTERN.test(text);
  const marketing = MARKETING_PATTERN.test(text);
  const marketingOnly = marketing && !legalConsent;
  if (input.required) {
    return {
      required: true,
      legalConsent,
      marketingOnly,
      shouldCheck: true,
      checkKind: 'required',
    };
  }
  if (legalConsent) {
    return {
      required: false,
      legalConsent: true,
      marketingOnly: false,
      shouldCheck: true,
      checkKind: 'optional_legal',
    };
  }
  if (marketingOnly && input.alwaysCheckOptionalMarketing) {
    return {
      required: false,
      legalConsent: false,
      marketingOnly: true,
      shouldCheck: true,
      checkKind: 'optional_marketing',
    };
  }
  return {
    required: false,
    legalConsent,
    marketingOnly,
    shouldCheck: false,
    checkKind: 'skip',
  };
}

async function readCheckboxMetadata(locator: any): Promise<{
  checked: boolean;
  required: boolean;
  text: string;
  selector: string;
  isNative: boolean;
}> {
  const meta = await locator.evaluate((el: any) => {
    const attr = (name: string) => String(el.getAttribute?.(name) || '').trim();
    const id = attr('id');
    const labelledBy = attr('aria-labelledby')
      .split(/\s+/)
      .filter(Boolean)
      .map((labelId: string) => el.ownerDocument?.getElementById?.(labelId)?.textContent || '')
      .join(' ');
    const explicitLabel = id ? (el.ownerDocument?.querySelector?.(`label[for="${id.replace(/"/g, '\\"')}"]`)?.textContent || '') : '';
    const closestLabel = el.closest?.('label')?.textContent || '';
    const parentText = el.parentElement?.textContent || '';
    const type = attr('type');
    const role = attr('role');
    const checked = type === 'checkbox'
      ? !!el.checked
      : attr('aria-checked') === 'true';
    const required = el.hasAttribute?.('required') || attr('aria-required') === 'true';
    const selector = [
      String(el.tagName || '').toLowerCase(),
      id ? `#${id}` : '',
      attr('name') ? `[name="${attr('name')}"]` : '',
      role ? `[role="${role}"]` : '',
      type ? `[type="${type}"]` : '',
    ].join('');
    return {
      checked,
      required,
      text: [explicitLabel, closestLabel, labelledBy, attr('aria-label'), attr('title'), attr('name'), parentText].join(' ').replace(/\s+/g, ' ').trim(),
      selector: selector.slice(0, 140),
      isNative: type === 'checkbox',
    };
  }).catch(() => null);

  return meta || {
    checked: false,
    required: false,
    text: '',
    selector: 'checkbox',
    isNative: false,
  };
}

async function currentCheckedState(locator: any, isNative: boolean): Promise<boolean> {
  if (isNative) return await locator.isChecked().catch(() => false);
  return (await locator.getAttribute('aria-checked').catch(() => '')) === 'true';
}

async function tryCheck(locator: any, isNative: boolean): Promise<boolean> {
  await locator.scrollIntoViewIfNeeded?.().catch(() => undefined);
  if (await currentCheckedState(locator, isNative)) return true;

  if (isNative) {
    await locator.check?.({ timeout: 2500 }).catch(() => undefined);
    if (await currentCheckedState(locator, isNative)) return true;
  }

  await locator.click?.({ timeout: 2500 }).catch(() => undefined);
  if (await currentCheckedState(locator, isNative)) return true;

  await locator.evaluate((el: any) => {
    if (typeof el.click === 'function') el.click();
  }).catch(() => undefined);
  return await currentCheckedState(locator, isNative);
}

export async function ensureConsentCheckboxes(scope: any, options: {
  alwaysCheckOptionalMarketing?: boolean;
  debugLog?: (message: string) => void;
} = {}): Promise<ConsentCheckboxSummary> {
  const boxes = scope.locator('input[type="checkbox"], [role="checkbox"]');
  const count = await boxes.count().catch(() => 0);
  const summary: ConsentCheckboxSummary = {
    checkboxesFound: count,
    requiredCheckedCount: 0,
    optionalCheckedCount: 0,
    uncheckedRequiredRemaining: 0,
    unresolvedRequired: [],
  };

  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    const meta = await readCheckboxMetadata(box);
    const visible = await box.isVisible().catch(() => false);
    const enabled = await box.isEnabled().catch(() => false);
    const ariaDisabled = (await box.getAttribute('aria-disabled').catch(() => '')) === 'true';
    const checkedBefore = meta.checked || await currentCheckedState(box, meta.isNative);
    const classification = classifyConsentCheckbox({
      text: meta.text,
      required: meta.required,
      alwaysCheckOptionalMarketing: options.alwaysCheckOptionalMarketing,
    });

    if (!checkedBefore && classification.shouldCheck && visible && enabled && !ariaDisabled) {
      const checkedAfter = await tryCheck(box, meta.isNative);
      if (checkedAfter) {
        if (classification.checkKind === 'required') summary.requiredCheckedCount += 1;
        else summary.optionalCheckedCount += 1;
      }
    }

    const finalChecked = await currentCheckedState(box, meta.isNative);
    if (meta.required && !finalChecked) {
      summary.uncheckedRequiredRemaining += 1;
      summary.unresolvedRequired.push({
        label: meta.text.slice(0, 160) || '(unlabeled checkbox)',
        selector: meta.selector || 'checkbox',
      });
      options.debugLog?.(`[debug] unresolved required checkbox selector=${meta.selector || 'checkbox'} label=${(meta.text || '').slice(0, 120) || '(unlabeled)'}`);
    }
  }

  return summary;
}
