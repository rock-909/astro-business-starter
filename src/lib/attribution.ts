export const ATTRIBUTION_FIELD_NAMES = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "landingPage",
  "capturedAt",
  "gclid",
  "wbraid",
  "gbraid",
] as const;

export type AttributionFieldName = (typeof ATTRIBUTION_FIELD_NAMES)[number];

export interface MarketingAttributionFields {
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
  utmTerm?: string | undefined;
  utmContent?: string | undefined;
  landingPage?: string | undefined;
  capturedAt?: string | undefined;
  gclid?: string | undefined;
  wbraid?: string | undefined;
  gbraid?: string | undefined;
}

// Google Ads 点击 ID：iOS 上的点击可能只带 wbraid 或 gbraid，不带 gclid。
export const CLICK_ID_FIELD_NAMES = ["gclid", "wbraid", "gbraid"] as const;
export type ClickIdFieldName = (typeof CLICK_ID_FIELD_NAMES)[number];

export function isClickIdField(
  fieldName: AttributionFieldName,
): fieldName is ClickIdFieldName {
  return (CLICK_ID_FIELD_NAMES as readonly string[]).includes(fieldName);
}

// 点击 ID 是 URL 安全的 base64 字符；其他字符都不是真实的点击 ID。
export const CLICK_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

// 归因值字符规则，浏览器捕获和服务端入口共用：允许可打印 ASCII 和 Unicode
// 字母、组合符号、数字（如 "promoción"），拦截控制/格式字符和危险的 HTML 分隔符。
export function isSafeAttributionValue(value: string): boolean {
  return (
    /^[\x20-\x7E\p{L}\p{M}\p{N}]+$/u.test(value) && !/[<>"'`\\]/.test(value)
  );
}

export function pickAttributionFields(
  source: object,
): MarketingAttributionFields {
  const data = source as Record<string, unknown>;
  const fields: MarketingAttributionFields = {};

  for (const fieldName of ATTRIBUTION_FIELD_NAMES) {
    const value = data[fieldName];
    // 非字符串或含危险字符的值整项丢弃，不拒绝询盘，与浏览器捕获一致；
    // 超长或点击 ID 格式不符的值不在这里处理，仍由 lead schema 返回 400。
    if (typeof value === "string" && isSafeAttributionValue(value.trim())) {
      fields[fieldName] = value.trim();
    }
  }

  return fields;
}

