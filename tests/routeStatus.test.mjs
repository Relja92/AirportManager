import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeStatus } from '../src/routeStatus.js';

const status = (overrides = {}) => routeStatus({ aircraftCount: 1, want: 200, seats: 500, profit: null, estimatedProfit: 12000, ...overrides });

test('profitable spare capacity is an advisory and estimates are labeled', () => {
  const actual = status({ profit: 10000 });
  assert.equal(actual.issues[0].tone, 'amber');
  assert.match(actual.issues[0].text, /Profitable yesterday/);
  assert.match(actual.issues[0].text, /40%/);
  assert.equal(actual.matches('losing'), false);
  assert.equal(actual.matches('spare'), true);
  assert.match(status().issues[0].label, /est\./);
  assert.match(status().issues[0].text, /no actual results yet/);
});

test('actual losses match both loss and capacity filters, even with zero flights', () => {
  const result = status({ profit: -1000 });
  assert.equal(result.matches('losing'), true);
  assert.equal(result.matches('spare'), true);
  assert.equal(result.matches('attention'), true);
  assert.equal(result.issues[0].tone, 'bad');
  assert.equal(status({ estimatedProfit: -5000 }).matches('losing'), false);
});

test('unassigned routes do not also suggest buying more capacity', () => {
  const result = status({ aircraftCount: 0, seats: 0 });
  assert.equal(result.matches('unassigned'), true);
  assert.equal(result.matches('demand'), false);
});

test('temporary closure or repairs suppress misleading capacity warnings', () => {
  for (const override of [{ closed: true }, { repairCount: 1 }]) {
    const result = status(override);
    assert.equal(result.matches('disrupted'), true);
    assert.equal(result.matches('spare'), false);
    assert.equal(status({ ...override, want: 1000 }).matches('demand'), false);
  }
});

test('capacity thresholds and break-even status stay distinct', () => {
  assert.equal(status({ seats: 320, profit: 0 }).matches('spare'), false);
  assert.equal(status({ seats: 160 }).matches('demand'), false);
  const short = status({ seats: 100 });
  assert.equal(short.matches('demand'), true);
  assert.match(short.issues[0].text, /100 passengers/);
  assert.equal(status({ seats: 200, profit: 10 }).matches('attention'), false);
  assert.equal(status({ seats: 200 }).matches('all'), true);
  assert.match(status({ profit: 0 }).issues[0].text, /Broke even/);
});

test('capacity advice only suggests a smaller aircraft when one is compatible', () => {
  assert.match(status().issues[0].text, /smallest compatible aircraft/);
  assert.match(status({ canDownsize: true }).issues[0].text, /Compare a smaller compatible/);
  assert.match(status({ aircraftCount: 2 }).issues[0].text, /moving one aircraft/);
});
