// GET /api/tx/:sig -> the $PONK trade in that Solana transaction, decoded server-side.
// The Helius key lives only here, in the HELIUS_KEY environment variable set in Netlify.
//   200 { trade }        trade is null when the transaction isn't a $PONK buy or sell (cached forever: transactions never change)
//   202 { pending }      the RPC hasn't indexed it yet; ask again shortly
const MINT = process.env.PONK_MINT || '4jjQjDRYd7xLcFMViRsz4GvtgU6gPZgbVaxN3Rq9pump';
const WSOL = 'So11111111111111111111111111111111111111112';
const SUPPLY = 1e9;            // pump.fun tokens have a fixed 1B supply
const ATA_RENT = 0.00203928;   // SOL locked when a buyer's token account is created
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
// the Netlify variable may be named HELIUS_KEY, HELIUS or Helius
export const heliusKey = () => (process.env.HELIUS_KEY || process.env.HELIUS || process.env.Helius || '').trim();

const json = (status, body, cache) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-store',
    ...(cache ? { 'netlify-cdn-cache-control': 'public, durable, s-maxage=31536000' } : {}),
  },
});

export function parseTx(tx, signature, mint = MINT) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
  const signer = keys[0];
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  const bal = (arr, m) => arr.filter((b) => b.mint === m && b.owner === signer)
    .reduce((n, b) => n + (parseFloat(b.uiTokenAmount.uiAmountString) || 0), 0);
  const tokAfter = bal(post, mint);
  const dTok = tokAfter - bal(pre, mint);
  if (Math.abs(dTok) < 1e-6) return null; // the signer's $PONK didn't move: not a trade
  const dLamports = (tx.meta.postBalances[0] - tx.meta.preBalances[0] + tx.meta.fee) / 1e9;
  const dSol = dLamports + (bal(post, WSOL) - bal(pre, WSOL));
  const buy = dTok > 0;
  if (buy ? dSol >= 0 : dSol <= 0) return null; // no SOL moved the other way: a transfer, not a swap
  let solAmount = Math.abs(dSol);
  if (buy && !pre.some((b) => b.mint === mint && b.owner === signer)) solAmount = Math.max(0, solAmount - ATA_RENT);
  return {
    signature, mint, traderPublicKey: signer, txType: buy ? 'buy' : 'sell',
    solAmount, tokenAmount: Math.abs(dTok), newTokenBalance: tokAfter,
    marketCapSol: solAmount > 0 ? (solAmount / Math.abs(dTok)) * SUPPLY : undefined,
  };
}

async function getTransaction(sig, key) {
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }],
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

export default async (req, context) => {
  const key = heliusKey();
  if (!key) return json(503, { error: 'HELIUS_KEY is not set' });
  const sig = context.params?.sig || new URL(req.url).pathname.split('/').pop();
  if (!SIG.test(sig)) return json(400, { error: 'bad signature' });
  for (let i = 0; i < 3; i++) {
    try {
      const tx = await getTransaction(sig, key);
      if (tx) return json(200, { trade: parseTx(tx, sig) }, true);
    } catch (err) {
      console.error('getTransaction', sig, err.message);
      // a permanent refusal (e.g. an unsupported transaction version) must not look like "not indexed yet"
      if (/version|not supported|invalid/i.test(err.message)) return json(502, { error: err.message });
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return json(202, { pending: true });
};

export const config = { path: '/api/tx/:sig' };
