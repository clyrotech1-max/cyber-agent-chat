// Allowlist guardrail - single source of truth for the whole backend.
// Owner-authorized targets only. Everything else is blocked by default.
const BASE_ALLOWED = new Set(["example.com", "example.org"]);
const LAB_PREFIXES = ["127.", "10.", "192.168."];
export function cleanDomain(d) {
  return String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}
export function isValidDomain(d) { return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d); }
export function isAllowed(host, extra) {
  if (!host) return false;
  const all = new Set([...BASE_ALLOWED, ...(extra || []).filter(isValidDomain)]);
  for (const d of all) { if (host === d || host.endsWith("." + d)) return true; }
  if (LAB_PREFIXES.some(p => host.startsWith(p))) return true;
  return false;
}
