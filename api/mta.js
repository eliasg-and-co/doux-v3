export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(
      'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json',
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timer);
    if (!r.ok) throw new Error(`MTA ${r.status}`);
    const data = await r.json();
    let lAlerts = 0;
    for (const entity of data.entity ?? []) {
      const alert = entity.alert;
      if (!alert) continue;
      const affectsL = (alert.informedEntity ?? []).some(ie => ie.routeId === 'L');
      if (!affectsL) continue;
      const now = Math.floor(Date.now() / 1000);
      const periods = alert.activePeriod ?? [];
      const isActive = periods.length === 0 || periods.some(p => {
        const start = p.start ?? 0;
        const end = p.end ?? Infinity;
        return now >= start && now <= end;
      });
      if (isActive) lAlerts++;
    }
    const norm = Math.min(1.0, lAlerts / 10);
    const display = lAlerts === 0 ? 'on time' : lAlerts === 1 ? '1 alert' : `${lAlerts} alerts`;
    return res.status(200).json({ lDelays: 0, lAlerts, combined: lAlerts, norm: parseFloat(norm.toFixed(4)), display, ts: Date.now() });
  } catch (e) {
    return res.status(200).json({ lDelays: 0, lAlerts: 0, combined: 0, norm: 0.1, display: '—', ts: Date.now() });
  }
}
