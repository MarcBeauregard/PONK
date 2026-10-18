// GET /api/health -> whether the server-side trade decoder is configured (HELIUS_KEY set in Netlify).
export default async () => new Response(JSON.stringify({ ready: Boolean(process.env.HELIUS_KEY) }), {
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export const config = { path: '/api/health' };
