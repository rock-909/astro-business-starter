import {
  ATTRIBUTION_FIELD_NAMES,
  CLICK_ID_FIELD_NAMES,
  CLICK_ID_PATTERN,
  isClickIdField,
  isSafeAttributionValue,
  type AttributionFieldName,
  type MarketingAttributionFields,
} from '../lib/attribution';

const storageKey = 'inquiry_attribution';
type AttributionConsent = { analytics: boolean; advertising: boolean };
let consent: AttributionConsent = { analytics: false, advertising: false };

function isAllowed(field: AttributionFieldName): boolean {
  return isClickIdField(field) ? consent.advertising : consent.analytics;
}

function sanitize(field: AttributionFieldName, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (isClickIdField(field)) return CLICK_ID_PATTERN.test(trimmed) ? trimmed : undefined;
  const bounded = trimmed.slice(0, 256);
  return bounded && isSafeAttributionValue(bounded) ? bounded : undefined;
}

function captureParams(): MarketingAttributionFields {
  if (!consent.analytics && !consent.advertising) return {};
  const search = new URLSearchParams(location.search);
  const params: MarketingAttributionFields = {};
  if (consent.analytics) {
    for (const [field, parameter] of [
      ['utmSource', 'utm_source'], ['utmMedium', 'utm_medium'],
      ['utmCampaign', 'utm_campaign'], ['utmTerm', 'utm_term'], ['utmContent', 'utm_content'],
    ] as const) {
      const value = sanitize(field, search.get(parameter));
      if (value) params[field] = value;
    }
  }
  if (consent.advertising) {
    for (const field of CLICK_ID_FIELD_NAMES) {
      const value = sanitize(field, search.get(field));
      if (value) params[field] = value;
    }
  }
  if (consent.analytics && Object.keys(params).length) {
    params.landingPage = location.pathname;
    params.capturedAt = new Date().toISOString();
  }
  return params;
}

export function getAttributionSnapshot(): MarketingAttributionFields {
  const stored: MarketingAttributionFields = {};
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const field of ATTRIBUTION_FIELD_NAMES) {
        if (!isAllowed(field)) continue;
        const value = sanitize(field, (parsed as Record<string, unknown>)[field]);
        if (value) stored[field] = value;
      }
    }
  } catch { /* Storage denial must not block an inquiry. */ }

  const current = captureParams();
  // Each consent category keeps its own first permitted touch.
  const hasAnalytics = Object.keys(stored).some(field => !isClickIdField(field as AttributionFieldName));
  const hasAdvertising = CLICK_ID_FIELD_NAMES.some(field => stored[field]);
  for (const field of ATTRIBUTION_FIELD_NAMES) {
    if (current[field] && !(isClickIdField(field) ? hasAdvertising : hasAnalytics)) stored[field] = current[field];
  }
  return stored;
}

export function applyAttributionConsent(next: AttributionConsent): void {
  consent = next;
  const data = getAttributionSnapshot();
  try {
    if (Object.keys(data).length) sessionStorage.setItem(storageKey, JSON.stringify(data));
    else sessionStorage.removeItem(storageKey);
  } catch { /* The current consent still filters submission when storage is unavailable. */ }
}
