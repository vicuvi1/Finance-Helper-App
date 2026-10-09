// Binance balances: pure parsers for the three read-only endpoints the
// desktop app calls, and the merge into one list of coins. The signed calls
// themselves happen in electron/binance.cjs (the API secret never reaches the
// page).

const qty = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// GET /api/v3/account -> { balances: [{ asset, free, locked }] }
export function parseSpot(json) {
  const out = {};
  for (const b of json?.balances || []) {
    const q = qty(b.free) + qty(b.locked);
    if (q > 0) out[b.asset] = q;
  }
  return out;
}

// POST /sapi/v1/asset/get-funding-asset -> [{ asset, free, locked, freeze }]
export function parseFunding(json) {
  const out = {};
  for (const b of Array.isArray(json) ? json : []) {
    const q = qty(b.free) + qty(b.locked) + qty(b.freeze);
    if (q > 0) out[b.asset] = q;
  }
  return out;
}

// GET /sapi/v1/simple-earn/flexible/position -> { rows: [{ asset, totalAmount }] }
export function parseEarn(json) {
  const out = {};
  for (const r of json?.rows || []) {
    const q = qty(r.totalAmount);
    if (q > 0) out[r.asset] = (out[r.asset] || 0) + q;
  }
  return out;
}

// Earn and some promos show up as LD<asset> in Spot ("LDBTC"): count them as
// the coin itself unless Earn already reported it.
function unwrapLd(spot, earn) {
  const out = {};
  for (const [a, q] of Object.entries(spot)) {
    if (a.startsWith('LD') && a.length > 2) {
      const base = a.slice(2);
      if (!earn[base]) out[base] = (out[base] || 0) + q;
    } else out[a] = (out[a] || 0) + q;
  }
  return out;
}

// One coin list with where each part sits, biggest first by count of wallets.
export function mergeHoldings({ spot = {}, funding = {}, earn = {} }) {
  const s = unwrapLd(spot, earn);
  const assets = new Set([...Object.keys(s), ...Object.keys(funding), ...Object.keys(earn)]);
  const rows = [...assets].map((asset) => {
    const wallets = { spot: s[asset] || 0, funding: funding[asset] || 0, earn: earn[asset] || 0 };
    const total = wallets.spot + wallets.funding + wallets.earn;
    return { asset, qty: Number(total.toPrecision(12)), wallets };
  });
  return rows.filter((r) => r.qty > 0).sort((a, b) => a.asset.localeCompare(b.asset));
}
