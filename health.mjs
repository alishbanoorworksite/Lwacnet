// Vercel same-origin gateway to the external LWACNet FastAPI service.
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  const backend = (process.env.LWACNET_BACKEND_URL || 'https://elliptic-scarcity-hexagram.ngrok-free.dev').trim().replace(/\/$/, '');
  if (!backend) return json({ status: 'unavailable' }, 503);
  try {
    const base = new URL(backend);
    if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid backend URL');
    const requestUrl = `${backend}/health`;
    const upstream = await fetch(requestUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return json({ status: 'unavailable' }, 503);
    const payload = await upstream.json();
    return json({ status: payload.status === 'ready' ? 'ready' : 'unavailable', model: payload.model || 'LWACNet' }, payload.status === 'ready' ? 200 : 503);
  } catch {
    return json({ status: 'unavailable' }, 503);
  }
}
