// api/mta.js — Vercel serverless function
// Proxies MTA GTFS-RT L train feed, parses protobuf server-side
// Fixed: removed invalid fetch timeout option, fixed protobuf decode,
//        added AbortController for real timeout support

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const L_FEED     = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l';
const ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts';

async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const r = await fetch(url, {
      headers: { 'x-api-key': '' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`MTA returned ${r.status}`);
    const buf = await r.arrayBuffer();
    // decode returns a FeedMessage object
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buf)
    );
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function countDelays(feed) {
  let count = 0;
  for (const entity of feed.entity ?? []) {
    const tu = entity.tripUpdate;
    if (!tu) continue;
    // Only count L train trips
    const routeId = tu.trip?.routeId;
    if (routeId && routeId !== 'L') continue;
    for (const stu of tu.stopTimeUpdate ?? []) {
      const arrDelay = stu.arrival?.delay ?? 0;
      const depDelay = stu.departure?.delay ?? 0;
      const delay = Math.max(
        typeof arrDelay === 'object' ? (arrDelay.low ?? 0) : arrDelay,
        typeof depDelay === 'object' ? (depDelay.low ?? 0) : depDelay
      );
      if (delay > 120) { count++; break; } // >2 min, count once per train
    }
  }
  return count;
}

function countLAlerts(feed) {
  let count = 0;
  for (const entity of feed.entity ?? []) {
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
    const [lResult, alertResult] = await Promise.allSettled([
      fetchFeed(L_FEED),
      fetchFeed(ALERTS_URL),
    ]);

    const lDelays = lResult.status === 'fulfilled'
      ? countDelays(lResult.value)
      : 0;

    const lAlerts = alertResult.status === 'fulfilled'
      ? countLAlerts(alertResult.value)
      : 0;

    // Log any fetch errors but don't crash
    if (lResult.status === 'rejected')
      console.error('L feed error:', lResult.reason?.message);
    if (alertResult.status === 'rejected')
      console.error('Alerts feed error:', alertResult.reason?.message);

    const combined = lDelays + lAlerts;
    const norm     = Math.min(1.0, combined / 30);

    let display;
    if (combined === 0) {
      display = 'on time';
    } else if (combined < 5) {
      display = `${combined} delay${combined !== 1 ? 's' : ''}`;
    } else if (combined < 15) {
      display = `${combined} delays`;
    } else {
      display = `${combined} delays — severe`;
    }

    return res.status(200).json({
      lDelays,
      lAlerts,
      combined,
      norm:    parseFloat(norm.toFixed(4)),
      display,
      ts:      Date.now(),
    });

  } catch (e) {
    console.error('MTA handler error:', e.message);
    // Neutral fallback — don't error the site
    return res.status(200).json({
      lDelays:  0,
      lAlerts:  0,
      combined: 0,
      norm:     0.1,
      display:  '—',
      ts:       Date.now(),
    });
  }
}
