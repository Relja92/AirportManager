// The long mission: serve every airport on the map. Pure rules; no DOM.
// An airport counts as served when it is one of your hubs or any of your routes ends there.
import { AIRPORTS, CONTINENTS, continentOf } from './data/airports.js';

export const WORLD_TOTAL = AIRPORTS.length;
export const CONTINENT_BONUS = 0.03; // demand on every route for each continent fully covered
// Each pays once. The last one is the whole map.
export const WORLD_MILESTONES = [
  { n: 25, reward: 250e3 },
  { n: 50, reward: 750e3 },
  { n: 100, reward: 2.5e6 },
  { n: 200, reward: 8e6 },
  { n: 300, reward: 20e6 },
  { n: WORLD_TOTAL, reward: 50e6 },
];
const CONTINENT_OF = Object.fromEntries(AIRPORTS.map((a) => [a.id, continentOf(a)]));
const CONTINENT_SIZE = Object.fromEntries(CONTINENTS.map((c) => [c, AIRPORTS.filter((a) => CONTINENT_OF[a.id] === c).length]));

export function servedIds(s) {
  const ids = new Set(s.hubs.map((h) => h.id));
  for (const r of s.routes) { ids.add(r.dest); ids.add(r.hub); }
  return ids;
}
export function worldProgress(s) {
  const ids = servedIds(s);
  const count = Object.fromEntries(CONTINENTS.map((c) => [c, 0]));
  let served = 0;
  for (const id of ids) { const c = CONTINENT_OF[id]; if (c) { count[c]++; served++; } }
  const continents = CONTINENTS.map((name) => ({ name, served: count[name], total: CONTINENT_SIZE[name], full: count[name] >= CONTINENT_SIZE[name] }));
  const full = continents.filter((c) => c.full).length;
  return { ids, served, total: WORLD_TOTAL, continents, full, bonus: 1 + CONTINENT_BONUS * full,
    next: WORLD_MILESTONES.find((m) => !(s.worldDone || []).includes(m.n)) || null };
}
export const milestoneName = (m) => (m.n >= WORLD_TOTAL ? 'Connect the world: every airport served' : `Serve ${m.n} airports`);
const cash = (n) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString()}M` : `$${Math.round(n / 1e3)}k`);

export const worldActions = {
  // Worked out once per change to the network, since demand asks for it constantly.
  worldProgress() {
    const s = this.state;
    const key = `${this._rev}:${s.routes.length}:${s.hubs.length}:${(s.worldDone || []).length}`;
    if (this._world?.key !== key || this._world.state !== s) this._world = { key, state: s, value: worldProgress(s) };
    return this._world.value;
  },
  worldFactor() { return this.worldProgress().bonus; },
  isServed(id) { return this.worldProgress().ids.has(id); },
  checkWorld() {
    const s = this.state;
    s.worldDone ||= [];
    const { served } = this.worldProgress();
    for (const m of WORLD_MILESTONES) {
      if (s.worldDone.includes(m.n) || served < m.n) continue;
      s.worldDone.push(m.n);
      s.money += m.reward;
      const all = m.n >= WORLD_TOTAL;
      this.recordCompanyEvent?.(`world:${m.n}`, 'milestones', milestoneName(m), all ? 'Every airport on the map is on your network.' : `${m.n} of ${WORLD_TOTAL} airports on your network.`);
      this.emit('toast', { text: `${all ? 'The world is connected: every airport served' : `World coverage: ${m.n} airports served`} · +${cash(m.reward)}`, kind: 'goal', sound: 'goal' });
    }
  },
};
