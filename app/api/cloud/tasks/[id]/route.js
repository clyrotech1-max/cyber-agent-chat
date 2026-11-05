const CLOUD = "https://cyber-agent-cloud.onrender.com";
export async function GET(_req, { params }) {
  try {
    const r = await fetch(`${CLOUD}/tasks/${params.id}`);
    const j = await r.json().catch(() => ({}));
    return Response.json(j, { status: r.status });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
