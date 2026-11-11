// Authored game-balancing profiles, not live airport statistics.
export const MARKET_PROFILES = {
  regional: { name: 'Regional market', summary: 'A mixed local market with affordable airport operations.', leisure: 1, business: 1, businessShare: .22, freight: 1, operating: .92, expansion: .9, connections: 1 },
  corporate: { name: 'Business city', summary: 'More business travelers; dependable, frequent service matters.', leisure: .95, business: 1.2, businessShare: .34, freight: 1.05, operating: 1.08, expansion: 1.08, connections: 1 },
  gateway: { name: 'Global gateway', summary: 'Strong business and connecting markets, with higher airport costs.', leisure: 1.03, business: 1.12, businessShare: .30, freight: 1.12, operating: 1.15, expansion: 1.18, connections: 1.12 },
  holiday: { name: 'Holiday destination', summary: 'Price-sensitive leisure demand with a strong seasonal swing.', leisure: 1.22, business: .65, businessShare: .12, freight: .8, operating: .95, expansion: 1, connections: .9 },
  logistics: { name: 'Freight center', summary: 'Stronger freight yields alongside a mixed passenger market.', leisure: .95, business: 1.05, businessShare: .25, freight: 1.3, operating: 1.05, expansion: .95, connections: 1.05 },
  remote: { name: 'Remote gateway', summary: 'Tourism and supplies support demand, but operating and building here cost more.', leisure: 1.08, business: .8, businessShare: .18, freight: 1.1, operating: 1.12, expansion: 1.2, connections: .9 },
};
const group = (ids) => new Set(ids.split(' '));
const CORPORATE = group('ZRH GVA BRU DUS STR LUX LCY BSL BOS DCA SJC AUS BLR HYD NRT GMP');
const LOGISTICS = group('FRA LEJ CGN LGG MEM SDF ANC SZX CGO OAK IND');
const REMOTE = group('USH IPC PPT NAN RAR GPS VLI APW NOU');
const GATEWAY = group('LHR CDG AMS IST DXB DOH AUH SIN HKG ICN HND JFK EWR ATL ORD LAX DFW PEK PVG DEL BOM SYD GRU');
const CONSTRAINED = group('LHR LCY HND NRT HKG JFK EWR LGA SFO SAN LIS GVA');

export function characteristicsFor(a) {
  const id = LOGISTICS.has(a.id) ? 'logistics' : REMOTE.has(a.id) ? 'remote' : GATEWAY.has(a.id) ? 'gateway'
    : CORPORATE.has(a.id) ? 'corporate' : a.leisure ? 'holiday' : a.size >= 4 ? 'gateway' : a.size >= 3 ? 'corporate' : 'regional';
  const profile = MARKET_PROFILES[id];
  return { id, ...profile, constrained: CONSTRAINED.has(a.id),
    expansion: CONSTRAINED.has(a.id) ? 1.3 : profile.expansion };
}

// Both endpoints shape a route's customers and freight yield.
export const routeMarket = (from, to) => {
  const a = from.market, b = to.market;
  return Object.fromEntries(['leisure', 'business', 'businessShare', 'freight', 'connections'].map((key) => [key, (a[key] + b[key]) / 2]));
};
