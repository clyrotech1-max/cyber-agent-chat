import { isAllowed, cleanDomain, isValidDomain } from "../../../lib/allowlist.js";
import { runFullScan } from "../../../lib/scanner.js";
import { buildReport } from "../../../lib/report.js";

// Simple in-memory rate limit: 10 scans / minute per IP (serverless instance).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 10;
}

export async function POST(req) {
  const started = Date.now();
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (rateLimited(ip)) return Response.json({ error: "Rate limit: 10 scans per minute. 1 minute ruk kar dobara try karo." }, { status: 429 });
    const body = await req.json().catch(() => ({}));
    const extra = Array.isArray(body.allowedDomains) ? body.allowedDomains.filter(d => typeof d === "string").map(cleanDomain).filter(isValidDomain) : [];
    const host = cleanDomain(body.target || "");
    if (!host || !isValidDomain(host)) return Response.json({ blocked: true, reason: `Valid domain likho, jaise example.com. Mila: ${host || "(khali)"}` }, { status: 400 });
    if (!isAllowed(host, extra)) {
      console.log(JSON.stringify({ event: "scan_blocked", host, ip, at: new Date().toISOString() }));
      return Response.json({ blocked: true, reason: `Target allowlist me nahi hai: ${host}. Sidebar ke "Allowed Domains" section me apna domain add karo, ya demo ke liye example.com use karo.` }, { status: 403 });
    }
    const scan = await runFullScan(host);
    scan.report = buildReport(scan, host);
    scan.tookMs = Date.now() - started;
    console.log(JSON.stringify({ event: "scan_done", host, status: scan.status, high: scan.severityCounts?.high || 0, tookMs: scan.tookMs }));
    return Response.json(scan);
  } catch (e) {
    console.log(JSON.stringify({ event: "scan_error", error: String(e?.message || e).slice(0, 200) }));
    return Response.json({ error: String(e && e.message ? e.message : e) }, { status: 500 });
  }
}
