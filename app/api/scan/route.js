const ALLOWED = new Set(["example.com", "example.org"]);
function isAllowed(host, extra) {
  if (!host) return false;
  const all = new Set([...ALLOWED, ...(extra || [])]);
  for (const d of all) { if (host === d || host.endsWith("." + d)) return true; }
  if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
  return false;
}
export async function POST(req) {
  try {
    const body = await req.json();
    const { target } = body;
    const extra = Array.isArray(body.allowedDomains) ? body.allowedDomains.filter(d => typeof d === "string" && /^[a-z0-9.-]+$/i.test(d)).map(d => d.toLowerCase()) : [];
    let host = String(target || "").replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    if (!isAllowed(host, extra)) {
      return Response.json({ blocked: true, reason: `Target allowlist me nahi hai: ${host}. Sidebar ke "Allowed Domains" section me apna domain add karo, ya demo ke liye example.com use karo.` }, { status: 403 });
    }
    const url = `https://${host}/`;
    const res = await fetch(url, { headers: { "User-Agent": "CyberAgent-Web/0.1 (security-headers-check)" }, redirect: "follow" });
    const headers = {};
    ["strict-transport-security","content-security-policy","x-frame-options","x-content-type-options","referrer-policy"].forEach(h => { headers[h] = res.headers.get(h) || "MISSING"; });
    const findings = [];
    if (headers["strict-transport-security"] === "MISSING") findings.push("Strict-Transport-Security missing hai - add karo (severity: medium)");
    if (headers["content-security-policy"] === "MISSING") findings.push("Content-Security-Policy missing hai - add karo (severity: medium)");
    if (headers["x-frame-options"] === "MISSING") findings.push("X-Frame-Options missing hai - add karo (severity: medium)");
    if (headers["x-content-type-options"] === "MISSING") findings.push("X-Content-Type-Options missing hai - add karo (severity: medium)");
    if (!findings.length) findings.push("Koi missing security header nahi mila (is scan ke hisab se)");
    return Response.json({ url, status: res.status, https: true, headers, findings });
  } catch (e) {
    return Response.json({ error: String(e && e.message ? e.message : e) }, { status: 500 });
  }
}
