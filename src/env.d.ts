/// <reference types="astro/client" />
declare namespace App {
  interface Locals { inquiryRetryAfter?: number }
}

// Minimal binding declaration; runtime values come only from the Worker binding.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
