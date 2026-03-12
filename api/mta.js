// api/mta.js — Vercel serverless function
// Proxies MTA GTFS-RT L train feed, parses protobuf server-side
// Deploy: place at /api/mta.js in your repo root
// Access: https://your-site.vercel.app/api/mta
//
// Requires: npm install gtfs-realtime-bindings node-fetch
// (add to package.json in repo root)

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const L_FEED    = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l';
const ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts';

async function fetchFeed(url) {
  const r = await fetch(url, {
    headers: { 'x-api-key': '' }, // MTA public feed — no key needed
    timeout: 10000
  });
  if (!r.ok) throw new Error(`MTA returned ${r.status}`);
  const buf = await r.arrayBuffer();
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
}

function countDelays(feed) {
  let count = 0;
  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    if (!tu) continue;
    for (const stu of tu.stopTimeUpdate) {
      const delay = stu.arrival?.delay ?? stu.departure?.delay ?? 0;
      if (delay > 120) { count++; break; } // >2 min, once per train
    }
  }
  return count;
}

function countLAlerts(feed) {
  let count = 0;
  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert) continue;
    for (const ie of alert.informedEntity ?? []) {
      if (ie.routeId === 'L') { count++; break; }
    }
  }
  return count;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const [lFeed, alertFeed] = await Promise.all([
      fetchFeed(L_FEED),
      fetchFeed(ALERTS_URL)
    ]);

    const lDelays  = countDelays(lFeed);
    const lAlerts  = countLAlerts(alertFeed);
    const combined = lDelays + lAlerts;

    // Mirrors mta.py normalization: cap at 30 L train issues
    const norm    = Math.min(1.0, combined / 30);
    const display = combined === 0
      ? 'L Train on time'
      : `L Train: ${combined} issue${combined !== 1 ? 's' : ''}`;

    res.json({
      lDelays,
      lAlerts,
      combined,
      norm:    parseFloat(norm.toFixed(4)),
      display,
      ts:      Date.now()
    });
  } catch (e) {
    // Neutral fallback
    res.status(200).json({
      lDelays: 0, lAlerts: 0, combined: 0,
      norm: 0.1, display: 'L Train (fallback)', ts: Date.now()
    });
  }
}
