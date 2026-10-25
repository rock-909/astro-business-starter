/**
 * Lead Pipeline Utility Functions
 */

export interface SplitNameResult {
  firstName: string;
  lastName: string;
}

export function splitName(fullName: string): SplitNameResult {
  const normalizedName = fullName.trim();
  const parts = normalizedName.split(/\s+/);

  if (parts.length === 1) {
    return { firstName: parts[0] ?? "", lastName: "" };
  }

  const lastName = parts.pop() ?? "";
  return { firstName: parts.join(" "), lastName };
}

export function generateLeadReferenceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `INQ-${timestamp}-${random}`;
}

