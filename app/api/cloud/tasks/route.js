const CLOUD = "https://cyber-agent-cloud.onrender.com";
export async function POST(req) {
  try {
    const body = await req.json();
    const r = await fetch(`${CLOUD}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return Response.json(j, { status: r.status });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
