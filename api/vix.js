// api/vix.js — Vercel serverless function
// Proxies Yahoo Finance ^VIX, handles CORS
// Deploy: place at /api/vix.js in your repo root
// Access: https://your-site.vercel.app/api/vix

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1m&range=1d';
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error(`Yahoo returned ${r.status}`);
    const data = await r.json();
    const meta = data.chart.result[0].meta;
    const current  = parseFloat(meta.regularMarketPrice ?? meta.previousClose ?? 20.0);
    const prev     = parseFloat(meta.previousClose ?? current);
    const norm     = Math.max(0, Math.min(1, (current - 10) / 35)); // 10=calm, 45=crisis
    const momentum = Math.pow(norm, 0.7);                           // tension curve from vix_osc.py
    const calm     = 1.0 - norm;
    const change   = prev > 0 ? Math.min(1, Math.abs(current - prev) / prev / 0.25) : 0;

    res.json({
      raw:      parseFloat(current.toFixed(2)),
      prev:     parseFloat(prev.toFixed(2)),
      norm:     parseFloat(norm.toFixed(4)),
      momentum: parseFloat(momentum.toFixed(4)),
      calm:     parseFloat(calm.toFixed(4)),
      change:   parseFloat(change.toFixed(4)),
      display:  `VIX ${current.toFixed(1)}`,
      ts:       Date.now()
    });
  } catch (e) {
    // Neutral fallback — same as vix_osc.py
    res.status(200).json({
      raw: 20.0, prev: 20.0, norm: 0.29, momentum: 0.45,
      calm: 0.71, change: 0.0, display: 'VIX 20.0 (fallback)', ts: Date.now()
    });
  }
}
