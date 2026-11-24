// Vercel Node Function: securely proxies the browser's prepared image to FastAPI.
// There are no mock predictions, placeholder counts or browser-visible backend secrets.
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const backend = (process.env.LWACNET_BACKEND_URL || 'https://elliptic-scarcity-hexagram.ngrok-free.dev').trim().replace(/\/$/, '');
  if (!backend) return json({ detail: 'Inference service not configured' }, 503);
  try {
    const base = new URL(backend);
    if (!['https:', 'http:'].includes(base.protocol)) return json({ detail: 'Service URL is invalid' }, 503);
    if (!(request.headers.get('content-type') || '').includes('application/json')) {
      return json({ detail: 'Expected JSON image payload' }, 415);
    }
    const { image, filename = 'crowd-image.jpg' } = await request.json();
    if (typeof image !== 'string' || !image.length || image.length > 3_300_000 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(image)) {
      return json({ detail: 'Invalid or oversized image data' }, 400);
    }
    const data = Buffer.from(image, 'base64');
    if (data.byteLength > 2_550_000) return json({ detail: 'Image exceeds the gateway upload limit' }, 413);
    const form = new FormData();
    const safeName = String(filename).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'crowd-image.jpg';
    form.set('image', new Blob([data], { type: 'image/jpeg' }), safeName);
    const upstream = await fetch(`${backend}/predict`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    let result;
    try { result = await upstream.json(); } catch { return json({ detail: 'Model service returned an invalid response' }, 502); }
    return json(result, upstream.status);
  } catch (error) {
    if (error?.name === 'TimeoutError') return json({ detail: 'Inference request timed out' }, 504);
    return json({ detail: 'Model service could not be reached' }, 502);
  }
}
