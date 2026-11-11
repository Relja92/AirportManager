// Reproducible balance audit: node tests/simulateRivalCommercial.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { geoDistance } from 'd3-geo';
import { AIRPORTS, AIRPORT_BY_ID } from '../src/data/airports.js';
import { AIRCRAFT, AIRCRAFT_LIST, PLANE_CAP } from '../src/data/catalog.js';
import { createRivals, stepRivals, rivalHubIds } from '../src/rivals.js';
const dist = (a, b) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;
const runs = [];
const homes=process.env.RIVAL_SIM_HOME?[process.env.RIVAL_SIM_HOME]:['LHR','DEN','NBO','AKL'];
const difficulties=process.env.RIVAL_SIM_DIFFICULTY?[process.env.RIVAL_SIM_DIFFICULTY]:['easy','normal','hard'];
for (const home of homes) for (const diff of difficulties) {
  let seed = 14117 + home.charCodeAt(0);
  const rand = () => { let t = seed = (seed + 0x6d2b79f5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const s = { day: 0, diff, hubs: [{ id: home }], routes: [], planes: [], events: [], fuel: 1, rep: 85, rivals: [] };
  s.rivals = createRivals(s, rand);
  let routeId = 0;
  const develop = (id) => {
    for (const a of AIRPORTS.filter((a) => a.id !== id && dist(a, AIRPORT_BY_ID[id]) < 6200).sort((a, b) => b.size - a.size).slice(0, 12)) {
      const km = dist(a, AIRPORT_BY_ID[id]), t = AIRCRAFT_LIST.find((t) => t.seats >= 180 && t.range >= km);
      const r = { id: ++routeId, hub: id, dest: a.id, price: 0.7, hot: 8, yesterday: { pax: 1000, flights: 8 } };
      s.routes.push(r); s.planes.push({ routeId: r.id, type: t.id, phase: 'home' });
    }
  };
  develop(home);
  let warnings = 0, wars = 0, recoveries = 0, peakLosses = 0, longestStepMs = 0, totalStepMs = 0;
  const policies=new Set(),roles=new Set();
  for (let day = 1; day <= 360; day++) {
    s.day = day; s.fuel = 1 + Math.sin(day / 19) * 0.25;
    if ([90, 180].includes(day)) {
      const owned = new Set([...s.hubs.map((h) => h.id), ...s.rivals.flatMap(rivalHubIds)]);
      const next = AIRPORTS.filter((a) => a.size >= 4 && !owned.has(a.id)).sort((a, b) => dist(a, AIRPORT_BY_ID[home]) - dist(b, AIRPORT_BY_ID[home]))[0];
      if (next) { s.hubs.push({ id: next.id }); develop(next.id); }
    }
    s.events = day % 60 < 4 ? [{ type: 'fuelSpike', start: day - day % 60, days: 4 }] : [];
    if (day >= 110 && day < 116) s.events.push({ type: 'storm', airport: s.rivals[0].hub, start: 110, days: 6 });
    const before = s.rivals.map((r) => r.profit);
    const started=performance.now(); const news = stepRivals(s, rand); const elapsed=performance.now()-started; longestStepMs=Math.max(longestStepMs,elapsed);totalStepMs+=elapsed;
    wars += news.filter((n) => /Price war/.test(n.text)).length;
    warnings += news.filter((n) => /Seeking a buyer/.test(n.text)).length;
    recoveries += s.rivals.filter((r, i) => before[i] < 0 && r.profit >= 0).length;
    peakLosses = Math.max(peakLosses, s.rivals.filter((r) => r.profit < 0).length);
    const owned = [...s.hubs.map((h) => h.id), ...s.rivals.flatMap(rivalHubIds)];
    assert.equal(new Set(owned).size, owned.length);
    for (const rv of s.rivals) {
      assert.ok(Number.isFinite(rv.cash) && Number.isFinite(rv.profit));
      for (const h of rv.hubs) assert.ok(rv.routes.filter((r) => r.hub === h.id).length <= PLANE_CAP[h.level]);
      for (const h of rv.hubs) roles.add(h.specialization || 'general');
      for (const r of rv.routes) {
        policies.add(r.service || 'balanced');
        assert.ok(dist(AIRPORT_BY_ID[r.hub], AIRPORT_BY_ID[r.dest]) <= AIRCRAFT[r.type].range);
        if(r.lease) { assert.ok(r.lease.end>s.day*1440);assert.ok(r.lease.billedUntil<=s.day*1440);assert.ok(r.lease.daily>0); }
      }
    }
  }
  const result = { home, difficulty: diff, days: 360, survivors: s.rivals.filter((r) => r.hub).length, failures: s.rivalsDown || 0,
    hubs: s.rivals.map((r) => r.hubs.length), routes: s.rivals.map((r) => r.routes.length), wars, warnings, recoveries, peakLosses,
    policies:[...policies],roles:[...roles],commercial:s.rivals.map(r=>r.commercialStats),timing:{longestStepMs:Math.round(longestStepMs),averageStepMs:Math.round(totalStepMs/360)},
    cashMillions: s.rivals.map((r) => Math.round(r.cash / 1e6)), profitsThousands: s.rivals.map((r) => Math.round(r.profit / 1000)) };
  assert.ok(result.survivors >= 3, `${home} ${diff}: too many failures`);
  assert.ok(result.hubs.filter((n) => n > 1).length >= 3, `${home} ${diff}: growth stalled`);
  runs.push(result);
  console.log(`${home} ${diff}: ${result.survivors} survivors, ${result.hubs.join('/')} hubs, ${wars} wars, ${recoveries} recoveries; ${result.commercial.reduce((n,r)=>n+r.leased,0)} leases, roles ${result.roles.join('/')} (${result.timing.averageStepMs}ms/day)`);
}
await mkdir(new URL('../reports/ai-integration-pass/', import.meta.url), { recursive: true });
await writeFile(new URL(process.env.RIVAL_SIM_REPORT || '../reports/ai-integration-pass/balance.json', import.meta.url), JSON.stringify({ scenario: '360 days against a growing three-hub player at 70% fares, fuel swings, fuel spikes and a six-day hub closure', runs }, null, 2));
