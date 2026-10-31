import { actions, isInputError } from 'astro:actions';
import { getAttributionSnapshot } from './attribution';
import { saveDraft, restoreDraft, clearDraft } from './inquiry-draft';
import { inquiryLimits } from '../lib/inquiry-limits';
import type { Locale } from '../site-routes';
import type { Messages } from '../site';

type Copy = Messages['inquiry']['form'];
interface Turnstile {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
}
const globals = window as unknown as { turnstile?: Turnstile };
const form = document.querySelector<HTMLFormElement>('[data-inquiry-form]')!;
const copy: Copy = JSON.parse(form.dataset.copy!);
const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
const submitLabel = submit.querySelector<HTMLElement>('[data-submit-label]')!;
const status = form.querySelector<HTMLElement>('[data-form-status]')!;
const verification = form.querySelector<HTMLElement>('[data-verification-status]')!;
const siteKey = form.dataset.siteKey || '';
let token = '';
let widget: string | undefined;
let pending = false;
let cooldownUntil = 0;
function syncButton() {
  submit.disabled = pending || !token || Date.now() < cooldownUntil;
  submitLabel.textContent = pending ? copy.submitting : copy.submit;
  form.setAttribute('aria-busy', String(pending));
  for (const name of ['fullName', 'email', 'message'])
    (form.elements.namedItem(name) as HTMLInputElement).disabled = pending;
}
function report(text: string, state: 'error' | 'success') {
  const prefix = document.createElement('strong');
  prefix.textContent = copy.statusPrefix[state];
  status.replaceChildren(prefix, ` ${text}`);
  status.dataset.state = state;
}
// The status box takes the reference site's four tones; the text prefix carries the
// outcome for success and error without relying on colour.
function inform(text: string) {
  status.textContent = text;
  status.dataset.state = 'info';
}
// Failures read in the error colour, an expired check as a warning, progress stays grey.
function verificationNote(text: string, tone?: 'error' | 'warning') {
  verification.textContent = text;
  if (tone) verification.dataset.tone = tone;
  else delete verification.dataset.tone;
}
function resetVerification() {
  token = '';
  if (widget !== undefined) {
    try {
      globals.turnstile?.reset(widget);
    } catch {
      verificationNote(copy.turnstile.unavailable, 'error');
    }
  }
  syncButton();
}
function fieldError(name: 'fullName' | 'email' | 'message', text: string) {
  const field = form.elements.namedItem(name) as HTMLInputElement;
  const error = document.getElementById(`${name}-error`)!;
  field.setAttribute('aria-invalid', 'true');
  error.textContent = text;
  error.hidden = false;
}
function clearErrors() {
  for (const name of ['fullName', 'email', 'message']) {
    (form.elements.namedItem(name) as HTMLInputElement).removeAttribute('aria-invalid');
    document.getElementById(`${name}-error`)!.hidden = true;
  }
}
restoreDraft(form);
form.addEventListener('input', () => saveDraft(form));
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-locale-link]')) {
  link.addEventListener('click', (event) => {
    if (link.dataset.localeLink === form.dataset.locale) return;
    if (pending) {
      event.preventDefault();
      inform(copy.localePending);
      status.focus();
      return;
    }
    const data = new FormData(form);
    if (!Object.keys(inquiryLimits).some((name) => data.get(name))) return;
    if (!saveDraft(form)) {
      event.preventDefault();
      report(copy.localeStorageUnavailable, 'error');
      status.focus();
    }
  });
}
function renderWidget() {
  if (!globals.turnstile) {
    verificationNote(copy.turnstile.loadFailed, 'error');
    return;
  }
  try {
    const slot = form.querySelector<HTMLElement>('[data-turnstile]')!;
    widget = globals.turnstile.render(slot, {
      sitekey: siteKey,
      // The fixed 300px "normal" widget overflows narrow phones (WCAG 1.4.10).
      ...(slot.clientWidth < 300 ? { size: 'compact' } : {}),
      action: 'product_inquiry',
      language: form.dataset.locale,
      callback: (value: string) => {
        token = value;
        verificationNote('');
        syncButton();
      },
      'expired-callback': () => {
        token = '';
        verificationNote(copy.turnstile.expired, 'warning');
        syncButton();
      },
      'error-callback': () => {
        token = '';
        verificationNote(copy.turnstile.unavailable, 'error');
        syncButton();
      },
      'timeout-callback': () => {
        token = '';
        verificationNote(copy.turnstile.expired, 'warning');
        syncButton();
      },
    });
    // The widget is on screen and prompts for itself; only failures need words here.
    if (verification.textContent === copy.turnstile.loading) verificationNote('');
  } catch {
    verificationNote(copy.turnstile.unavailable, 'error');
  }
}
if (!siteKey) verificationNote(copy.turnstile.unavailable, 'error');
else {
  verificationNote(copy.turnstile.loading);
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.defer = true;
  script.addEventListener('load', renderWidget);
  script.addEventListener('error', () => {
    verificationNote(copy.turnstile.loadFailed, 'error');
  });
  document.head.append(script);
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending || Date.now() < cooldownUntil) return;
  clearErrors();
  const data = new FormData(form);
  const fullName = String(data.get('fullName') || '').trim();
  const email = String(data.get('email') || '').trim();
  const message = String(data.get('message') || '').trim();
  let invalid = false;
  if (!fullName) {
    fieldError('fullName', copy.errors.fullName.required);
    invalid = true;
  } else if (fullName.length > inquiryLimits.fullName) {
    fieldError('fullName', copy.errors.fullName.tooLong);
    invalid = true;
  }
  if (!email) {
    fieldError('email', copy.errors.email.required);
    invalid = true;
  } else if (email.length > inquiryLimits.email) {
    fieldError('email', copy.errors.email.tooLong);
    invalid = true;
  } else if (!(form.elements.namedItem('email') as HTMLInputElement).validity.valid) {
    fieldError('email', copy.errors.email.invalid);
    invalid = true;
  }
  if (message.length > inquiryLimits.message) {
    fieldError('message', copy.errors.message.tooLong);
    invalid = true;
  }
  if (invalid) {
    report(copy.errors.fieldSummary, 'error');
    form.querySelector<HTMLElement>('[aria-invalid=true]')?.focus();
    return;
  }
  if (!token) {
    report(copy.errors.securitySummary, 'error');
    return;
  }
  pending = true;
  // Announce the wait and keep focus off <body> while the button and fields are disabled.
  inform(copy.submitting);
  if (form.contains(document.activeElement)) status.focus();
  syncButton();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      actions.inquiry({
        fullName,
        email,
        message,
        website: String(data.get('website') || ''),
        turnstileToken: token,
        locale: form.dataset.locale as Locale,
        ...getAttributionSnapshot(),
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RESPONSE_UNKNOWN')), 30_000);
      }),
    ]);
    if (result.error) {
      if (isInputError(result.error)) {
        for (const name of ['fullName', 'email', 'message'] as const)
          if (result.error.fields[name]) fieldError(name, copy.errors[name].invalid);
        report(copy.errors.fieldSummary, 'error');
      } else if (result.error.message.startsWith('{')) {
        let recognized = false;
        try {
          const details: unknown = JSON.parse(result.error.message);
          if (
            details &&
            typeof details === 'object' &&
            'code' in details &&
            details.code === 'INQUIRY_VALIDATION_FAILED' &&
            'fields' in details &&
            Array.isArray(details.fields)
          ) {
            for (const name of ['fullName', 'email', 'message'] as const)
              if (details.fields.includes(name)) fieldError(name, copy.errors[name].invalid);
            report(copy.errors.fieldSummary, 'error');
            recognized = true;
          }
        } catch {
          /* Never render unrecognized server messages. */
        }
        if (!recognized) report(copy.unknown, 'error');
      } else if (result.error.message === 'RATE_LIMIT_EXCEEDED') {
        cooldownUntil = Date.now() + 60_000;
        report(copy.errors.rateLimitSummary, 'error');
        setTimeout(() => {
          if (!pending && Date.now() >= cooldownUntil) {
            report(copy.errors.rateLimitReady, 'success');
            syncButton();
          }
        }, 60_000);
      } else if (result.error.message === 'TURNSTILE_UNAVAILABLE')
        report(copy.turnstile.unavailable, 'error');
      else if (result.error.message.startsWith('TURNSTILE_'))
        report(copy.errors.securitySummary, 'error');
      else if (result.error.message === 'INQUIRY_VALIDATION_FAILED')
        report(copy.errors.fieldSummary, 'error');
      else report(copy.unknown, 'error');
    } else if (
      result.data?.success === true &&
      typeof result.data.referenceId === 'string' &&
      /^INQ-[A-Za-z0-9-]+$/.test(result.data.referenceId)
    ) {
      report(`${copy.success} ${copy.referenceLabel}: ${result.data.referenceId}`, 'success');
      form.reset();
      clearDraft();
      document.dispatchEvent(new Event('inquiry:accepted'));
    } else report(copy.unknown, 'error');
  } catch {
    report(copy.unknown, 'error');
  } finally {
    if (timer) clearTimeout(timer);
    pending = false;
    resetVerification();
    (form.querySelector<HTMLElement>('[aria-invalid=true]') || status).focus();
  }
});
syncButton();
