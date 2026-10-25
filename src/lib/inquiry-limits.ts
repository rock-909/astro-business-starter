/** Shared field bounds; canonical sanitization remains server-owned. */
export const inquiryLimits = { fullName: 100, email: 254, message: 2000 } as const;
