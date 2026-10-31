/**
 * Lead Pipeline Schema Definitions
 * Canonical inquiry schema for the registered inquiry Action. Its output is the one validated
 * inquiry shape handed to owner email and Airtable delivery.
 */

import {
  email,
  enum as zEnum,
  literal,
  object,
  type output as ZodOutput,
  string,
  union,
  undefined as zUndefined,
  unknown,
  type ZodOptional,
  type ZodString,
  type ZodType,
} from 'astro/zod';
import { type AttributionFieldName, CLICK_ID_PATTERN } from './attribution';
import { sanitizeMultilineText, sanitizePlainText } from './text';
import { inquiryLimits } from './inquiry-limits';
import { locales } from '../site-routes';
const hasSpreadsheetFormulaPrefix = (value: string) => /^[=+\-@]/.test(value);

export const INQUIRY_LEAD_TYPE = 'inquiry' as const;

const sanitizedString = () => string().overwrite(sanitizePlainText);
const MAX_ATTRIBUTION_FIELD_LENGTH = 256;

const leadAttributionFields = {
  utmSource: sanitizedString().max(MAX_ATTRIBUTION_FIELD_LENGTH).optional(),
  utmMedium: sanitizedString().max(MAX_ATTRIBUTION_FIELD_LENGTH).optional(),
  utmCampaign: sanitizedString().max(MAX_ATTRIBUTION_FIELD_LENGTH).optional(),
  utmTerm: sanitizedString().max(MAX_ATTRIBUTION_FIELD_LENGTH).optional(),
  utmContent: sanitizedString().max(MAX_ATTRIBUTION_FIELD_LENGTH).optional(),
  landingPage: sanitizedString().max(MAX_ATTRIBUTION_FIELD_LENGTH).optional(),
  capturedAt: sanitizedString().max(MAX_ATTRIBUTION_FIELD_LENGTH).optional(),
  gclid: string().regex(CLICK_ID_PATTERN).optional(),
  wbraid: string().regex(CLICK_ID_PATTERN).optional(),
  gbraid: string().regex(CLICK_ID_PATTERN).optional(),
} satisfies Record<AttributionFieldName, ZodOptional<ZodString>>;

function normalizeOptionalInput(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined;
  }
  return typeof value === 'string' ? value.trim() : value;
}

// 在 zod 默认邮箱正则基础上只放宽浏览器 type="email" 接受的两类：
// local part 允许 & 和 #，顶级域允许 xn-- punycode；域名仍至少要有一个点。
const BUYER_EMAIL_PATTERN =
  // 回溯安全：结构与 zod 默认邮箱正则相同：每个域名标签以 . 结尾、无歧义回溯，且输入受请求体大小限制。
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.&#]*)[A-Za-z0-9_+\-&#]@([A-Za-z0-9][A-Za-z0-9-]*\.)+([A-Za-z]{2,}|[xX][nN]--[A-Za-z0-9-]*[A-Za-z0-9])$/;

const buyerMessageSchema: ZodType<string | undefined> = unknown()
  .transform(normalizeOptionalInput)
  .pipe(
    union([zUndefined(), string().overwrite(sanitizeMultilineText).max(inquiryLimits.message)]),
  );

export const inquiryLeadSchema = object({
  type: literal(INQUIRY_LEAD_TYPE),
  fullName: sanitizedString().min(1).max(inquiryLimits.fullName),
  // 邮箱小写化只在这里做：owner 邮件的 reply-to 与 Airtable 的 Email 列都读这个值。
  email: email({ pattern: BUYER_EMAIL_PATTERN })
    .overwrite((value) => value.toLowerCase())
    .min(1)
    .max(inquiryLimits.email)
    .refine((value) => !hasSpreadsheetFormulaPrefix(value)),
  message: buyerMessageSchema.optional(),
  // 买家提交时所在页面的语言；只接受站点配置的 locale，不收自由文本。
  locale: zEnum(locales).optional(),
  ...leadAttributionFields,
});

export type InquiryLeadInput = ZodOutput<typeof inquiryLeadSchema>;

export type ValidatedInquiry = InquiryLeadInput & { referenceId: string };
