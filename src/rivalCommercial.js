// Shared commercial terms; rival planning uses daily ledgers, leases keep minute
// timestamps so taking over an airline preserves the exact remaining contract.
import { AIRCRAFT, UPGRADES, difficultyOf } from './data/catalog.js';
import { AIRPORT_BY_ID } from './data/airports.js';
import { LEASE_TERMS } from './commercial.js';
import { SPECIALIZATIONS, specializationOf, specializationRequirementsFor } from './specializations.js';
export const DAY = 1440;
export const rivalHubLevels = (h) => ({runway:h.level,terminal:h.level,gates:h.level,amenities:h.amenities || 0,cargo:h.cargo || 0,fuel:0,marketing:0});
export const rivalAircraftValue = (r) => r.lease ? 0 : AIRCRAFT[r.type].price * Math.min(.6,Math.max(.12,.6-(r.age || 0)/500));
export function rivalLeaseCommitment(rv, minute) {
  return rv.routes.reduce((n,r)=>n+(r.lease ? Math.max(0,r.lease.end-minute)/DAY*r.lease.daily : 0),0);
}
export function rivalLeaseAccrued(rv, minute) {
  return rv.routes.reduce((n,r)=>n+(r.lease ? Math.max(0,Math.min(minute,r.lease.end)-r.lease.billedUntil)/DAY*r.lease.daily : 0),0);
}
export function rivalLeaseTerms(s, typeId, days) {
  const term=LEASE_TERMS.find((t)=>t.days===days),type=AIRCRAFT[typeId];
  if (!term || !type) return null;
  const fee=Math.round(type.price*.03),daily=Math.round(type.price*term.rate);
  return {fee,commitment:fee+daily*days,lease:{days,daily,start:s.day*DAY,end:(s.day+days)*DAY,billedUntil:s.day*DAY}};
}
export function rivalHubUpkeep(h,s) {
  const total=Object.values(rivalHubLevels(h)).reduce((n,v)=>n+v,0);
  return 500*total**1.6*(1+(total/24)**3)*difficultyOf(s).costs*AIRPORT_BY_ID[h.id].market.operating*specializationOf(h).upkeep;
}
export function rivalRoleSetup(h,role,staffedRoutes,s) {
  if (!SPECIALIZATIONS[role]) return {why:'Unknown hub role'};
  const next={...h,specialization:role};let cost=SPECIALIZATIONS[role].fee;
  // Specialist facilities are purchased at the same local upgrade prices.
  for (const [key,needed] of role==='premium' ? [['amenities',2]] : role==='cargo' ? [['cargo',2]] : []) {
    const start=next[key] || 0;
    for (let level=start;level<needed;level++) cost+=Math.round(UPGRADES[key].costs[level]*difficultyOf(s).costs*(key==='cargo'?AIRPORT_BY_ID[h.id].market.expansion:1)/1000)*1000;
    next[key]=Math.max(start,needed);
  }
  const requirements=specializationRequirementsFor(rivalHubLevels(next),role,staffedRoutes);
  return {hub:next,cost,requirements,why:requirements.some((r)=>!r.met)?'Unlock requirements are not met':null};
}
