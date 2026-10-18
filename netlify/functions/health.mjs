// GET /api/health -> whether the server-side trade decoder is configured (Helius key set in Netlify).
import { heliusKey } from './tx.mjs';

export default async () => new Response(JSON.stringify({ ready: Boolean(heliusKey()) }), {
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export const config = { path: '/api/health' };
