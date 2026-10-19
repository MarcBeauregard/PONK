// GET /api/recent -> the latest successful transaction signatures on the $PONK mint (cached 15 s at the CDN).
// Safety net for the live feed: the page decodes any it hasn't seen through /api/tx/:sig.
import { heliusKey } from './tx.mjs';

const MINT = process.env.PONK_MINT || '4jjQjDRYd7xLcFMViRsz4GvtgU6gPZgbVaxN3Rq9pump';
const json = (status, body, cacheS) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...(cacheS ? { 'netlify-cdn-cache-control': `public, s-maxage=${cacheS}` } : {}),
  },
});

export default async () => {
  const key = heliusKey();
  if (!key) return json(503, { error: 'Helius key is not set' });
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [MINT, { limit: 25, commitment: 'confirmed' }] }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return json(200, { signatures: (j.result || []).filter((x) => !x.err).map((x) => x.signature) }, 15);
  } catch (err) {
    return json(502, { error: err.message });
  }
};

export const config = { path: '/api/recent' };
