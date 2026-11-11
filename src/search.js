import { AIRPORTS, AIRPORT_BY_ID } from './data/airports.js';
import { AIRCRAFT } from './data/catalog.js';

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function matchesSearch(query, ...values) {
  const haystack = normalize(values.join(' '));
  return normalize(query).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}
export const airportMatches = (a, q) => matchesSearch(q, a.id, a.city, a.country, a.market?.name);
export const routeMatches = (r, q) => matchesSearch(q, r.hub, r.dest, AIRPORT_BY_ID[r.hub]?.city, AIRPORT_BY_ID[r.dest]?.city, AIRPORT_BY_ID[r.dest]?.country);
export function planeMatches(game, p, q) {
  const r = game.route(p.routeId);
  return matchesSearch(q, p.name, p.registration, AIRCRAFT[p.type].name, p.hub, AIRPORT_BY_ID[p.hub]?.city, r?.dest, AIRPORT_BY_ID[r?.dest]?.city, r ? '' : 'parked');
}
export function searchNetwork(game, query) {
  if (!normalize(query)) return { routes: [], planes: [], airports: [] };
  const exact = (a, b) => Number(normalize(b.id) === normalize(query)) - Number(normalize(a.id) === normalize(query));
  return { routes: game.state.routes.filter((r) => routeMatches(r, query)),
    planes: game.state.planes.filter((p) => planeMatches(game, p, query)),
    airports: AIRPORTS.filter((a) => airportMatches(a, query)).sort(exact) };
}
