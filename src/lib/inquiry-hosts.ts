/**
 * Turnstile hostnames from TURNSTILE_ALLOWED_HOSTS. The Worker and readiness share
 * this so both read the value the same way. Accepts bare hostnames or URLs
 * (`https://host/`, `host:443`) separated by commas, semicolons or whitespace.
 */
export function parseAllowedHosts(value: string): { hosts: string[]; invalid: number } {
  const hosts = new Set<string>();
  let invalid = 0;
  for (const entry of value.split(/[\s,;]+/).filter(Boolean)) {
    let host = '';
    try {
      host = new URL(entry.includes('://') ? entry : `https://${entry}`).hostname.toLowerCase();
    } catch {
      /* Counted as invalid below. */
    }
    if (/^[a-z0-9.-]+$/.test(host)) hosts.add(host);
    else invalid++;
  }
  return { hosts: [...hosts], invalid };
}
