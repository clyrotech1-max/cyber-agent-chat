// Defensive scanner - read-only probes only. No login attempts, no password
// guessing, no form submission, no exploitation. Only public HTTP responses.
async function probe(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "CyberAgent-Web/0.3 (defensive-security-check)" }, redirect: "manual", signal: ctrl.signal });
    clearTimeout(timer);
    let body = "";
    try { body = (await r.text()).slice(0, 4000); } catch {}
    return { status: r.status, location: r.headers.get("location") || "", server: r.headers.get("server") || "", poweredBy: r.headers.get("x-powered-by") || "", body };
  } catch (e) { clearTimeout(timer); return { status: 0, error: String(e.message || e).slice(0, 120) }; }
}
export async function runFullScan(host) {
  const url = `https://${host}/`;
  const res = await fetch(url, { headers: { "User-Agent": "CyberAgent-Web/0.3 (defensive-security-check)" }, redirect: "follow" });
  const headers = {};
  ["strict-transport-security","content-security-policy","x-frame-options","x-content-type-options","referrer-policy","server","x-powered-by"].forEach(h => { headers[h] = res.headers.get(h) || "MISSING"; });
  const html = await res.text().catch(() => "");
  const findings = [];
  const add = (sev, text) => findings.push({ severity: sev, text });
  if (headers["strict-transport-security"] === "MISSING") add("medium", "Strict-Transport-Security MISSING - MITM risk on HTTP, add HSTS max-age=31536000; includeSubDomains");
  else add("ok", `Strict-Transport-Security PRESENT: ${headers["strict-transport-security"]}`);
  if (headers["content-security-policy"] === "MISSING") add("medium", "Content-Security-Policy MISSING - XSS / injection risk, add CSP");
  else add("ok", "Content-Security-Policy PRESENT");
  if (headers["x-frame-options"] === "MISSING") add("low", "X-Frame-Options MISSING - clickjacking risk, add DENY or SAMEORIGIN");
  else add("ok", `X-Frame-Options PRESENT: ${headers["x-frame-options"]}`);
  if (headers["x-content-type-options"] === "MISSING") add("low", "X-Content-Type-Options MISSING - add nosniff");
  else add("ok", `X-Content-Type-Options PRESENT: ${headers["x-content-type-options"]}`);
  if (headers["referrer-policy"] === "MISSING") add("low", "Referrer-Policy MISSING - add strict-origin-when-cross-origin");
  else add("ok", "Referrer-Policy PRESENT");
  if (headers["server"] !== "MISSING") add("low", `Server header leaks version info: ${headers["server"]} - hide server version`);
  if (headers["x-powered-by"] !== "MISSING") add("low", `X-Powered-By leaks stack: ${headers["x-powered-by"]} - remove this header`);
  const gen = (html.match(/<meta[^>]*name=["']generator["'][^>]*>/i) || [""])[0];
  if (gen) add("low", `Generator meta tag leaks CMS/version: ${gen.slice(0,120)}`);
  const tech = [];
  if (/wp-content|wp-includes/i.test(html)) { tech.push("WordPress"); add("info", "WordPress detected in HTML - keep WP + plugins updated, remove unused plugins"); }
  if (/next\/|_next\//i.test(html)) tech.push("Next.js");
  const httpProbePromise = probe(`http://${host}/`, 4000);
  const httpProbe = await httpProbePromise;
  const httpsRedirect = httpProbe.status >= 300 && httpProbe.status < 400 && /https:/i.test(httpProbe.location || "");
  if (httpsRedirect) add("ok", `HTTP redirects to HTTPS (${httpProbe.status} -> ${httpProbe.location})`);
  else add("medium", `HTTP does NOT redirect to HTTPS (status ${httpProbe.status}) - force HTTPS redirect`);
  const exposedPaths = ["/.env", "/.git/HEAD", "/robots.txt", "/security.txt", "/.well-known/security.txt", "/wp-login.php", "/admin"];
  const exposedRes = await Promise.all(exposedPaths.map(async p => ({ path: p, status: (await probe(`https://${host}${p}`, 5000)).status || 0 })));
  const exposedFiles = exposedRes;
  const envPublic = exposedFiles.some(e => e.path === "/.env" && e.status === 200);
  const gitPublic = exposedFiles.some(e => e.path === "/.git/HEAD" && e.status === 200);
  if (envPublic) add("high", "CRITICAL: /.env is publicly reachable (200) - secrets may leak, block it immediately");
  if (gitPublic) add("high", "HIGH: /.git/HEAD is publicly reachable (200) - source history may leak, block .git");
  const loginRes = await Promise.all(["/wp-login.php", "/login", "/admin/login"].map(async p => ({ path: p, status: (await probe(`https://${host}${p}`, 5000)).status || 0 })));
  const loginPage = (loginRes.find(r => r.status === 200) || {}).path || "";
  if (loginPage) {
    const lp = await probe(`https://${host}${loginPage}`, 5000);
    const hasCaptcha = /captcha|recaptcha|hcaptcha/i.test(lp.body || "");
    const has2fa = /two.factor|2fa|otp|authenticator/i.test(lp.body || "");
    add("info", `Login page found at ${loginPage} - password guessing was NOT done. Defence check: captcha ${hasCaptcha ? "FOUND" : "NOT seen"}, 2FA mention ${has2fa ? "FOUND" : "NOT seen"}. Fix: rate-limit 5 attempts/minute, lockout after 5 fails, MFA on admin, captcha on login.`);
  } else add("info", "No common login page found at /wp-login.php, /login, /admin/login - if login exists elsewhere, check its rate-limit + MFA there.");
  const counts = { high: 0, medium: 0, low: 0, ok: 0, info: 0 };
  findings.forEach(f => { if (counts[f.severity] !== undefined) counts[f.severity]++; });
  return { url, status: res.status, https: true, httpsRedirect, headers, tech, exposedFiles: exposedFiles.map(e => `${e.path} -> ${e.status || "no response"}`), loginPage: loginPage || "not found", findings: findings.map(f => `[${f.severity.toUpperCase()}] ${f.text}`), severityCounts: counts, scannedAt: new Date().toISOString() };
}
