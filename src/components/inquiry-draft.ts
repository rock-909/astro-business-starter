/** Same-tab inquiry recovery, adapted from the source form. Never stores tokens. */
import { inquiryLimits } from '../lib/inquiry-limits';

const key = 'inquiry-draft';
export function saveDraft(form: HTMLFormElement): boolean {
  const draft = Object.fromEntries(
    Object.entries(inquiryLimits).map(([name, limit]) => [
      name,
      (form.elements.namedItem(name) as HTMLInputElement).value.slice(0, limit),
    ]),
  );
  try {
    if (Object.values(draft).some(Boolean)) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
export function restoreDraft(form: HTMLFormElement): void {
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return;
    for (const [name, limit] of Object.entries(inquiryLimits)) {
      const value = (draft as Record<string, unknown>)[name];
      if (typeof value === 'string')
        (form.elements.namedItem(name) as HTMLInputElement).value = value.slice(0, limit);
    }
  } catch {
    /* Storage denial cannot disable the form. */
  }
}
export function clearDraft(): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Already accepted. */
  }
}
