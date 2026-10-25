/**
 * Markdown heading → anchor id 的纯字符串解析规则。
 *
 * 渲染器（H2/H3 锚点）与内容加载器（目录提取）是它的两个真实调用方，
 * 因此独立成无 React 的叶子模块：内容读取不需要为此拖入渲染依赖图。
 */

const EXPLICIT_ID_PATTERN = /\s*\\?\{#([a-z0-9-]+)\\?\}\s*$/;

function slugifyHeading(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") {
    return "";
  }

  // 只去掉拉丁字母上的重音；其他文字的组合符号（假名浊点、天城文元音符）属于字母本身。
  return trimmed
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function parseHeadingId(text: string): {
  displayText: string;
  id: string;
} {
  const match = EXPLICIT_ID_PATTERN.exec(text);
  if (match) {
    return {
      displayText: text.slice(0, match.index).trim(),
      id: match[1] ?? "",
    };
  }
  return { displayText: text, id: slugifyHeading(text) };
}

