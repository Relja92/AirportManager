// World events: scheduled weeks ahead so the player can plan around them on the calendar.
import { AIRPORTS, AIRPORT_BY_ID } from './data/airports.js';

export const EVENT_TYPES = {
  festival: { icon: '★', color: '#ffd166', weight: 34 },
  storm: { icon: '☁', color: '#ff7b6b', weight: 18 },
  fuelSpike: { icon: '▲', color: '#ff9f5a', weight: 11 },
  fuelDip: { icon: '▼', color: '#5fd69a', weight: 8 },
  holiday: { icon: '☀', color: '#7cc4e8', weight: 9 },
  slump: { icon: '↘', color: '#9aa9b8', weight: 6 },
  sale: { icon: '%', color: '#b79cff', weight: 7 },
  strike: { icon: '!', color: '#ff7b6b', weight: 7 },
};
const FESTIVALS = ['Film Festival', 'Grand Prix', 'World Expo', 'Music Week', 'Cup Final', 'Trade Fair', 'Carnival', 'Tech Summit', 'Marathon Weekend'];
const HORIZON = 45; // days of future events kept on the calendar

export const isActive = (e, day) => e.start <= day && day < e.start + e.days;
export const activeEvents = (s) => s.events.filter((e) => isActive(e, s.day));

export function describe(e) {
  const a = e.airport && AIRPORT_BY_ID[e.airport];
  const d = `${e.days} day${e.days === 1 ? '' : 's'}`;
  switch (e.type) {
    case 'festival': return { title: `${e.name} in ${a.city}`, text: `Demand to and from ${a.id} ×${e.mult} for ${d}.` };
    case 'storm': return { title: `Storm over ${a.city}`, text: `${a.id} is closed for ${d}. Flights hold at the gate.` };
    case 'fuelSpike': return { title: 'Fuel price spike', text: e.hedged ? `Fuel +45% for ${d}. You are hedged, so it won’t touch you.` : `Fuel costs +45% on top of the market price for ${d}.` };
    case 'fuelDip': return { title: 'Cheap fuel', text: `Fuel costs −25% for ${d}.` };
    case 'holiday': return { title: 'Holiday rush', text: `Demand +30% on every route for ${d}.` };
    case 'slump': return { title: 'Travel slump', text: `Demand −20% on every route for ${d}.` };
    case 'sale': return { title: 'Aircraft sale', text: `Every aircraft is 20% off for ${d}.` };
    case 'strike': return { title: `Ground crew strike in ${a.city}`, text: e.settled ? 'Settled. Operations continue as normal.' : `${a.id} shuts for ${d} unless you settle with the union.` };
    default: return { title: e.type, text: '' };
  }
}

// ---------- effects ----------
export function eventDemand(s, hubId, destId) {
  let f = 1;
  for (const e of s.events) {
    if (!isActive(e, s.day)) continue;
    if (e.type === 'festival' && (e.airport === destId || e.airport === hubId)) f *= e.mult;
    else if (e.type === 'holiday') f *= 1.3;
    else if (e.type === 'slump') f *= 0.8;
  }
  return f;
}
// The market price drifts day to day; a price lock replaces it, spikes and all, until it runs out.
export function fuelFactor(s) {
  if (s.fuelLock && s.day < s.fuelLock.until) return s.fuelLock.price;
  let f = s.fuel ?? 1;
  for (const e of s.events) {
    if (!isActive(e, s.day)) continue;
    if (e.type === 'fuelSpike' && !e.hedged) f *= 1.45;
    else if (e.type === 'fuelDip') f *= 0.75;
  }
  return f;
}
export function closedBy(s, airportId) {
  return s.events.find((e) => isActive(e, s.day) && e.airport === airportId
    && (e.type === 'storm' || (e.type === 'strike' && !e.settled))) || null;
}
export const aircraftDiscount = (s) => (s.events.some((e) => e.type === 'sale' && isActive(e, s.day)) ? 0.8 : 1);

// ---------- scheduling ----------
function pick(rand, list) { return list[Math.floor(rand() * list.length)]; }

function makeEvent(s, rand, ctx, start) {
  const types = Object.keys(EVENT_TYPES).filter((t) => t !== 'strike' || start > 12);
  let roll = rand() * types.reduce((n, t) => n + EVENT_TYPES[t].weight, 0);
  const type = types.find((t) => (roll -= EVENT_TYPES[t].weight) < 0) || 'festival';
  const e = { id: s.nextId++, type, start, days: 1 };
  const overlaps = (t) => s.events.some((o) => o.type === t && o.start < start + 6 && start < o.start + o.days + 2);
  const hubIds = s.hubs.map((h) => h.id);
  const dests = [...new Set(s.routes.map((r) => r.dest))];

  if (type === 'festival') {
    const near = ctx.reachable().filter((a) => !hubIds.includes(a.id));
    const pool = dests.length && rand() < 0.5 ? dests.map((id) => AIRPORT_BY_ID[id]) : near;
    if (!pool.length) return null;
    e.airport = pick(rand, pool).id;
    e.name = pick(rand, FESTIVALS);
    e.days = 3 + Math.floor(rand() * 3);
    e.mult = rand() < 0.3 ? 3 : 2.2;
  } else if (type === 'storm') {
    const mine = [...dests, ...hubIds];
    e.airport = mine.length && rand() < 0.65 ? pick(rand, mine) : pick(rand, AIRPORTS).id;
  } else if (type === 'strike') {
    e.airport = pick(rand, hubIds);
    e.settled = false;
  } else {
    if (overlaps(type)) return null;
    e.days = { fuelSpike: 4, fuelDip: 3, holiday: 4, slump: 3, sale: 2 }[type];
    if (type === 'fuelSpike') e.hedged = false;
  }
  if (e.airport && s.events.some((o) => o.airport === e.airport && o.start < start + e.days && start < o.start + o.days)) return null;
  return e;
}

export function scheduleEvents(s, rand, ctx) {
  if (s.eventsUntil == null) s.eventsUntil = s.day + 2; // a quiet first couple of days
  while (s.eventsUntil < s.day + HORIZON) {
    const day = ++s.eventsUntil;
    if (rand() > 0.24) continue;
    const e = makeEvent(s, rand, ctx, day);
    if (e) s.events.push(e);
  }
  s.events = s.events.filter((e) => e.start + e.days > s.day - 2);
}
