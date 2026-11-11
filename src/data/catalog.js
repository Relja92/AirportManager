// Aircraft, airport upgrades, goals and scenarios. All tuning numbers live here.
import { AIRPORT_BY_ID, CONTINENTS, continentOf } from './airports.js';

export const AIRCRAFT = {
  sparrow: {
    id: 'sparrow', name: 'Sparrow 48', kind: 'Turboprop', cls: 1,
    seats: 48, range: 1500, speed: 510, price: 300e3, burn: 1.6, fee: 400, turnaround: 40, cargo: 1,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel 90', kind: 'Regional jet', cls: 2,
    seats: 90, range: 3200, speed: 780, price: 1.2e6, burn: 3.2, fee: 900, turnaround: 50, cargo: 2.5,
  },
  heron: {
    id: 'heron', name: 'Heron 180', kind: 'Narrow-body', cls: 3,
    seats: 180, range: 6200, speed: 840, price: 4e6, burn: 5.5, fee: 2000, turnaround: 60, cargo: 6,
  },
  albatross: {
    id: 'albatross', name: 'Albatross 310', kind: 'Wide-body', cls: 4,
    seats: 310, range: 12500, speed: 900, price: 11e6, burn: 11, fee: 5000, turnaround: 90, cargo: 20,
  },
  condor: {
    id: 'condor', name: 'Condor 520', kind: 'Jumbo', cls: 5,
    seats: 520, range: 15500, speed: 910, price: 18e6, burn: 16, fee: 9000, turnaround: 120, cargo: 32,
  },
};
// Freighters share the same gate, runway, lease and maintenance rules.
for (const [base,cargo,price] of [['sparrow',6,450000],['heron',28,5200000],['albatross',75,14000000]]) {
  const source=AIRCRAFT[base],id=`${base}_f`;
  AIRCRAFT[id]={...source,id,name:`${source.name.split(' ')[0]} ${cargo}F`,kind:'Freighter',seats:0,cargo,price,
    burn:source.burn*1.08,turnaround:source.turnaround+20,freighter:true,convertFrom:base};
}
export const AIRCRAFT_LIST = Object.values(AIRCRAFT);

export const ROUTE_CAP = [0, 3, 6, 10, 15, 22, 30];
export const PLANE_CAP = [0, 2, 4, 7, 11, 16, 24];
export const AMENITY_INCOME = [0, 5, 11, 18, 26, 35];
export const CARGO_FILL = [0, 0.4, 0.6, 0.8, 1];
export const CARGO_RATE = 0.25; // $ per tonne-km
export const USED = { price: 0.55, age: 150 }; // second-hand aircraft

// Cabin layouts: `b` is the share of floor space given to business class.
// A business seat takes two economy seats' room and sells for three times the fare.
export const CABINS = [
  { name: 'All economy', b: 0 },
  { name: 'Mixed', b: 0.2 },
  { name: 'Premium', b: 0.4 },
];

const maxRangeForClass = (cls) =>
  Math.max(...AIRCRAFT_LIST.filter((a) => a.cls <= cls).map((a) => a.range));

// `start` is the level a new airport begins with; costs[i] buys level start+i+1.
export const UPGRADES = {
  runway: {
    name: 'Runway', start: 1, costs: [500e3, 2.5e6, 10e6, 30e6],
    fx: (l) => `Class ${l} aircraft · routes up to ${maxRangeForClass(l).toLocaleString()} km`,
  },
  terminal: {
    name: 'Terminal', start: 1, costs: [350e3, 1.2e6, 5e6, 16e6, 45e6],
    fx: (l) => `${ROUTE_CAP[l]} routes · +${(l - 1) * 15}% demand`,
  },
  gates: {
    name: 'Gates', start: 1, costs: [250e3, 900e3, 4e6, 12e6, 36e6],
    fx: (l) => `${PLANE_CAP[l]} aircraft`,
  },
  amenities: {
    name: 'Shops & lounges', start: 0, costs: [150e3, 500e3, 1.5e6, 6e6, 20e6],
    fx: (l) => (l ? `+$${AMENITY_INCOME[l]} per passenger` : 'No extra income'),
  },
  cargo: {
    name: 'Cargo terminal', start: 0, costs: [200e3, 800e3, 4e6, 14e6],
    fx: (l) => (l ? `Freight fills ${CARGO_FILL[l] * 100}% of every hold` : 'Holds fly empty'),
  },
  fuel: {
    name: 'Fuel depot', start: 0, costs: [250e3, 1e6, 5e6, 16e6],
    fx: (l) => (l ? `−${l * 8}% fuel cost` : 'Market-price fuel'),
  },
  marketing: {
    name: 'Marketing', start: 0, costs: [120e3, 450e3, 1.5e6, 6e6, 20e6],
    fx: (l) => (l ? `+${l * 18}% demand` : 'Word of mouth only'),
  },
};
export const UPGRADE_KEYS = Object.keys(UPGRADES);
export const maxLevel = (key) => UPGRADES[key].start + UPGRADES[key].costs.length;

export const RANKS = [
  [0, 'Airstrip'],
  [6, 'Regional Airport'],
  [11, 'National Airport'],
  [17, 'International Airport'],
  [24, 'Global Hub'],
];
export function totalLevels(levels) {
  return UPGRADE_KEYS.reduce((n, k) => n + (levels[k] || 0), 0);
}
export function rankFor(levels) {
  const t = totalLevels(levels);
  let i = 0;
  while (i + 1 < RANKS.length && t >= RANKS[i + 1][0]) i++;
  const next = RANKS[i + 1];
  return { name: RANKS[i][1], index: i, total: t, at: RANKS[i][0], nextAt: next ? next[0] : null, nextName: next ? next[1] : null };
}
export const bestRank = (s) => Math.max(...s.hubs.map((h) => rankFor(h.levels).index));

export const GOALS = [
  { id: 'route1', title: 'Open your first route', reward: 50e3, test: (s) => s.routes.length >= 1 },
  { id: 'flight1', title: 'Land your first flight', reward: 25e3, test: (s) => s.flights >= 1 },
  { id: 'route3', title: 'Operate 3 routes', reward: 100e3, test: (s) => s.routes.length >= 3 },
  { id: 'pax5k', title: 'Carry 5,000 passengers', reward: 150e3, test: (s) => s.totalPax >= 5000 },
  { id: 'runway2', title: 'Upgrade a runway to level 2', reward: 200e3, test: (s) => s.hubs.some((h) => h.levels.runway >= 2) },
  { id: 'fleet5', title: 'Own 5 aircraft', reward: 300e3, test: (s) => s.planes.length >= 5 },
  { id: 'profit250k', title: 'Earn $250k profit in one day', reward: 500e3, test: (s) => s.bestDay >= 250e3 },
  { id: 'contract3', title: 'Complete 3 contracts', reward: 250e3, test: (s) => (s.contractsDone || 0) >= 3 },
  { id: 'hub2', title: 'Open a second hub', reward: 1e6, test: (s) => s.hubs.length >= 2 },
  { id: 'longhaul', title: 'Open a route longer than 6,000 km', reward: 1e6, test: (s) => s.routes.some((r) => r.km > 6000) },
  { id: 'pax100k', title: 'Carry 100,000 passengers', reward: 2e6, test: (s) => s.totalPax >= 100e3 },
  { id: 'route15', title: 'Operate 15 routes', reward: 3e6, test: (s) => s.routes.length >= 15 },
  { id: 'profit5m', title: 'Earn $5M profit in one day', reward: 10e6, test: (s) => s.bestDay >= 5e6 },
  { id: 'globalhub', title: 'Turn an airport into a Global Hub', reward: 25e6, test: (s) => bestRank(s) >= 4 },
];

// How forgiving the world is. The daily challenge always uses normal so everyone plays the same game.
export const DIFFICULTY = {
  easy: { name: 'Easy', desc: 'More cash and passengers, cheaper upkeep, slower rival expansion and steadier fuel.', cash: 1.5, demand: 1.1, rivals: 0.7, wars: 0.5, fuel: 0.6, costs: 0.85 },
  normal: { name: 'Normal', desc: 'The game as designed.', cash: 1, demand: 1, rivals: 1, wars: 1, fuel: 1, costs: 1 },
  hard: { name: 'Hard', desc: 'Less cash, higher costs and volatile fuel. Rivals plan faster, build larger hub networks and protect bigger cash reserves.', cash: 0.6, demand: 0.86, rivals: 1.5, wars: 2, fuel: 1.5, costs: 1.2 },
};
export const difficultyOf = (s) => DIFFICULTY[s.diff] || DIFFICULTY.normal;

// Harder, open-ended targets for a company that has finished the goals. No cash, just the badge.
export const LISTING_VALUE = 600e6;
const served = (s) => [...s.hubs.map((h) => h.id), ...s.routes.map((r) => r.dest)];
export const ACHIEVEMENTS = [
  { id: 'hubs3', title: 'Three hubs', desc: 'Run three hubs at once', test: (s) => s.hubs.length >= 3 },
  { id: 'alltypes', title: 'One of each', desc: 'Own every passenger aircraft type at the same time', test: (s) => AIRCRAFT_LIST.filter(t=>!t.freighter).every((t) => s.planes.some((p) => p.type === t.id)) },
  { id: 'fleet20', title: 'Big fleet', desc: 'Own 20 aircraft', test: (s) => s.planes.length >= 20 },
  { id: 'contracts10', title: 'Reliable partner', desc: 'Complete 10 contracts', test: (s) => (s.contractsDone || 0) >= 10 },
  { id: 'warwon', title: 'Stood your ground', desc: 'See a rival off after a price war', test: (s) => (s.warsWon || 0) >= 1 },
  { id: 'takeover', title: 'Hostile takeover', desc: 'Buy out a weakened rival', test: (s) => (s.takeovers || 0) >= 1 },
  { id: 'sweep', title: 'Clean sweep', desc: 'See three rival airlines fall, bought or collapsed', test: (s) => (s.rivalsDown || 0) >= 3 },
  { id: 'rep90', title: 'Beloved', desc: 'Reach a reputation of 90', test: (s) => s.rep >= 90 },
  { id: 'top', title: 'Market leader', desc: 'Fly 10 routes and carry more passengers a day than every rival', test: (s, g) => s.routes.length >= 10 && s.rivals.every((rv) => g.myPax() > g.rivalPax(rv)) },
  { id: 'continents', title: 'Six continents', desc: 'Have a hub or route on every continent', test: (s) => new Set(served(s).map((id) => continentOf(AIRPORT_BY_ID[id]))).size >= CONTINENTS.length },
  { id: 'streak100', title: 'Steady hands', desc: '100 days in a row without a losing day', test: (s) => (s.streak || 0) >= 100 },
  { id: 'listed', title: 'Ring the bell', desc: 'List the company on the stock exchange', test: (s) => !!s.listed },
];

// Ways to start. `home` fixes the airport; without it the player picks one on the map.
export const SCENARIOS = [
  { id: 'free', name: 'Free play', desc: 'Pick any airport. $1M, no deadline. Optional chapter campaigns are available in Goals & campaigns.' },
  {
    id: 'sprint', name: 'Sixty-Day Sprint', desc: 'Any airport. Reach International Airport rank by day 60.',
    deadline: 60, goal: 'Reach International Airport rank', win: (s) => bestRank(s) >= 3,
  },
  {
    id: 'ushuaia', name: 'End of the World', home: 'USH', money: 1.8e6, levels: { runway: 2 },
    desc: 'Ushuaia. Your nearest neighbour is 2,400 km away. Reach National Airport rank by day 50.',
    deadline: 50, goal: 'Reach National Airport rank', win: (s) => bestRank(s) >= 2,
  },
  {
    id: 'debt', name: 'Borrowed Wings', home: 'LOS', money: 6e6, debt: 6e6,
    desc: 'Lagos, with $6M in the bank and all of it borrowed. Be debt-free with $10M cash by day 60.',
    deadline: 60, goal: 'Clear the debt and hold $10M cash', win: (s) => s.debt <= 0 && s.money >= 10e6,
  },
  {
    id: 'islands', name: 'Island Hopper', home: 'HNL', money: 14e6, levels: { runway: 4, gates: 2 },
    desc: 'Honolulu. Everything is an ocean away. Carry 30,000 passengers by day 50.',
    deadline: 50, goal: 'Carry 30,000 passengers', win: (s) => s.totalPax >= 30e3,
  },
  { id: 'daily', name: 'Daily challenge', deadline: 30, goal: 'Highest net worth at the end of day 30', desc: '' },
];
export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
