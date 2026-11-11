// Shared by the compact list, Operations and route details. Capacity is a
// planning estimate; yesterday's result is the only evidence of an actual loss.
export const ROUTE_FILTERS = [
  ['all', 'All routes'], ['attention', 'Needs attention'], ['losing', 'Losing money'],
  ['unassigned', 'No aircraft'], ['spare', 'Unused capacity'], ['demand', 'Unserved demand'],
  ['freight', 'Freight at risk'], ['disrupted', 'Disrupted'], ['connections', 'Connections at risk'],
];

export function routeStatus({ aircraftCount, repairCount = 0, closed = false, want, seats, profit, estimatedProfit, canDownsize = false, connectionsAtRisk = 0, cargo = false, freightAtRisk = 0, conversionCount = 0 }) {
  const issues = [];
  const n = (v) => Math.round(v).toLocaleString();
  const capacity = cargo ? `${n(seats)} tonnes of hold space for ${n(want)} tonnes booked a day, both ways.` : `${n(seats)} seats for ${n(want)} passengers a day, both ways.`;
  if (closed) issues.push({ id: 'disrupted', tone: 'bad', label: 'Airport closed',
    text: 'Flights are on hold while an airport is closed. Check the calendar before changing capacity.' });
  if (!aircraftCount) issues.push({ id: 'unassigned', tone: 'bad', label: 'No aircraft',
    text: 'This route cannot fly yet. Assign a parked aircraft or buy one for this route.' });
  if (repairCount) issues.push({ id: 'disrupted', tone: 'bad', label: 'Aircraft in repair',
    text: `${repairCount} of ${aircraftCount} aircraft in repair. Capacity below is planned capacity; check aircraft status before adding more.` });
  if (connectionsAtRisk) issues.push({id:'connections',tone:'amber',label:'Connections at risk',
    text:`${n(connectionsAtRisk)} travelers are waiting for this onward flight. Review service frequency, available aircraft and closures before their 12-hour connection window expires.`});
  if (freightAtRisk>.01) issues.push({id:'freight',tone:'amber',label:'Freight at risk',text:`${freightAtRisk.toFixed(1)} t waiting with a blocked flight or delivery due within 6 hours. Review freight deadlines, closures and aircraft assignments. Late delivery earns 25% of its booked rate; expired waiting bookings cost 10% compensation.`});
  if (profit != null && profit < 0) issues.push({ id: 'losing', tone: 'bad', label: 'Losing money',
    text: 'Lost money yesterday after aircraft upkeep. Review fares, running costs and aircraft assignment in route details.' });
  // Temporary disruptions should not masquerade as a permanent capacity problem.
  if (aircraftCount && !closed && !repairCount && !conversionCount && seats > want * 1.6) {
    const profitable = profit != null ? profit > 0 : estimatedProfit > 0;
    const result = profit != null ? profit > 0 ? 'Profitable yesterday.' : profit < 0 ? 'Lost money yesterday.' : 'Broke even yesterday.'
      : estimatedProfit > 0 ? 'Estimated to be profitable; no actual results yet.' : 'No actual results yet.';
    const next = aircraftCount > 1 ? 'Compare moving one aircraft to another route before buying or selling.'
      : canDownsize ? 'Compare a smaller compatible aircraft before spending.'
      : 'Already using the smallest compatible aircraft. Monitor profit and review fares before changing the fleet.';
    issues.push({ id: 'spare', tone: 'amber', label: profitable ? (cargo ? 'Spare hold · profitable' : 'Spare seats · profitable') + (profit == null ? ' est.' : '') : 'Unused capacity',
      text: `${capacity} About ${Math.min(100, Math.round(want / seats * 100))}% of planned ${cargo ? 'hold space is' : 'seats are'} needed at current demand. ${result} ${profitable ? 'No urgent change needed. ' : ''}${next}` });
  } else if (aircraftCount && !closed && !repairCount && !conversionCount && seats < want * 0.8) {
    issues.push({ id: 'demand', tone: 'good', label: 'Unserved demand',
      text: `${capacity} About ${n(want - seats)} ${cargo ? 'tonnes' : 'passengers'} a day exceed planned capacity. Compare adding an aircraft or using a larger one, and review the estimated gain first.` });
  }
  return { issues, matches: (filter) => filter === 'all' || (filter === 'attention' ? issues.length > 0 : issues.some((i) => i.id === filter)) };
}
