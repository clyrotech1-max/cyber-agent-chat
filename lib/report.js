// Turns a scan result into a readable report. Pure function, no I/O.
export function buildReport(scan, target) {
  const c = scan.severityCounts || {};
  const lines = [
    `# Cyber Agent Scan Report - ${target}`,
    ``,
    `Scanned: ${scan.scannedAt || ""} | URL: ${scan.url} | HTTP: ${scan.status}`,
    `Severity: HIGH ${c.high || 0} | MEDIUM ${c.medium || 0} | LOW ${c.low || 0} | OK ${c.ok || 0}`,
    ``,
    `## Findings`,
    ...(scan.findings || []).map(f => `- ${f}`),
    ``,
    `## Exposed files (read-only status check)`,
    ...(scan.exposedFiles || []).map(f => `- ${f}`),
    ``,
    `## Login defence`,
    `- Login page: ${scan.loginPage || "not found"} - password guessing was NOT done, only the defence check above.`,
    ``,
    `## What was NOT tested`,
    `- No password guessing / brute-force login attempts, no SQLi / XSS payloads, no form submission. Those need a separate authorised penetration test with written scope.`,
  ];
  return lines.join("\n");
}
