// GET /api/mcap -> { marketCap, priceUsd, dexId } for $PONK from DexScreener, cached 10 s at the CDN.
// Fallback for browsers that can't call DexScreener directly.
const MINT = process.env.PONK_MINT || '4jjQjDRYd7xLcFMViRsz4GvtgU6gPZgbVaxN3Rq9pump';

export default async () => {
  try {
    const j = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`)).json();
    const pairs = (j.pairs || []).filter((p) => p.baseToken && p.baseToken.address === MINT)
      .sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    const p = pairs[0];
    if (!p) return new Response(JSON.stringify({ marketCap: 0 }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    return new Response(JSON.stringify({ marketCap: +(p.marketCap || p.fdv) || 0, priceUsd: +p.priceUsd || 0, priceNative: +p.priceNative || 0, dexId: p.dexId }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'netlify-cdn-cache-control': 'public, s-maxage=10',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
};

export const config = { path: '/api/mcap' };
