export async function GET() {
  return Response.json({ ok: true, service: "cyber-agent", version: "0.3", time: new Date().toISOString(), endpoints: ["/api/scan", "/api/health"] });
}
