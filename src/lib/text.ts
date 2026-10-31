/**
 * 安全验证工具
 * Security validation utilities
 */

// 空白以外的控制字符和方向控制字符（U+202A-202E、U+2066-2069）：会在业主邮件和
// Airtable 里反转或伪装显示文字，买家正常输入用不到。
const DISPLAY_SPOOF_CHARS = /[\u202A-\u202E\u2066-\u2069]|[^\P{Cc}\s]/gu;

/**
 * Normalize plain text input: strip control and bidi characters, collapse
 * whitespace and trim.
 *
 * Deliberately does NOT strip angle brackets or protocol-like substrings —
 * buyer text like "width < 900mm" must survive intact. Injection defense
 * lives at the sinks: escapeHtml and formula-prefix escaping in
 * inquiry.ts.
 *
 * Use this for single-line fields: names, company names, subject, etc.
 */
export function sanitizePlainText(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input.replace(DISPLAY_SPOOF_CHARS, '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize multiline text input: preserve line breaks while collapsing
 * horizontal whitespace within each line.
 *
 * Use this for buyer free-text that is rendered as multiple lines downstream
 * (contact `message`). It keeps `\n` so multi-line
 * email/Airtable rendering stays meaningful, unlike the single-line
 * {@link sanitizePlainText} which flattens everything to one line.
 *
 * Rules:
 * - normalize `\r\n` / `\r` to `\n`;
 * - strip control and bidi characters other than whitespace (tabs collapse to
 *   a space below);
 * - collapse runs of spaces/tabs within a line to a single space;
 * - trim horizontal whitespace around each line break;
 * - cap runs of blank lines at one blank line;
 * - trim the whole value.
 */
export function sanitizeMultilineText(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/\r\n?/g, '\n')
    .replace(DISPLAY_SPOOF_CHARS, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
