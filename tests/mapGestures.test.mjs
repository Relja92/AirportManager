import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelGesture, panGlobe } from '../src/mapGestures.js';

test('sideways and diagonal trackpad swipes pan in the phone layout without zooming', () => {
  for (const [deltaX, deltaY] of [[80, 0], [80, 3], [-60, -2], [0, 40]]) {
    const gesture = wheelGesture({ deltaX, deltaY, deltaMode: 0 }, true);
    assert.equal(gesture.kind, 'pan');
    assert.equal(gesture.dx + deltaX, 0);
    assert.equal(gesture.dy + deltaY, 0);
    assert.equal(gesture.factor, undefined);
  }
});

test('trackpad pinch zooms in and out in both layouts, including a diagonal pinch', () => {
  for (const mobile of [true, false]) {
    const inward = wheelGesture({ deltaX: 2, deltaY: -12, ctrlKey: true }, mobile);
    const outward = wheelGesture({ deltaX: -2, deltaY: 12, ctrlKey: true }, mobile);
    assert.equal(inward.kind, 'zoom');
    assert.ok(inward.factor > 1);
    assert.ok(outward.factor < 1);
    assert.ok(Math.abs(inward.factor * outward.factor - 1) < 1e-12);
  }
});

test('desktop scrolling and line-based mouse wheels retain their zoom controls', () => {
  assert.equal(wheelGesture({ deltaY: 100 }, false).factor, Math.exp(-0.18));
  assert.equal(wheelGesture({ deltaY: -3, deltaMode: 1 }, true).kind, 'zoom');
  assert.equal(wheelGesture({ deltaX: 30, deltaY: 0 }, false), null);
});

test('empty and invalid wheel events do not move the camera', () => {
  for (const event of [{}, { deltaX: NaN }, { deltaY: Infinity }, { deltaX: 0, deltaY: 0 }]) {
    assert.equal(wheelGesture(event, true), null);
  }
});

test('a mobile trackpad swipe rotates Earth without changing its zoom', () => {
  const globe = { lon: 15, lat: 25, z: 2 };
  const swipe = wheelGesture({ deltaX: 80, deltaY: 4 }, true);
  panGlobe(globe, swipe.dx, swipe.dy, 200);
  assert.ok(globe.lon > 15);
  assert.ok(globe.lat < 25);
  assert.equal(globe.z, 2);
  const reverse = wheelGesture({ deltaX: -80, deltaY: -4 }, true);
  panGlobe(globe, reverse.dx, reverse.dy, 200);
  assert.ok(Math.abs(globe.lon - 15) < 1e-12);
  assert.ok(Math.abs(globe.lat - 25) < 1e-12);
});

test('Earth rotation scales with zoom and stays within the pole limits', () => {
  const near = { lon: 0, lat: 0, z: 4 }, far = { lon: 0, lat: 0, z: 1 };
  panGlobe(near, 100, 0, 800);
  panGlobe(far, 100, 0, 200);
  assert.equal(far.lon, near.lon * 4);
  panGlobe(far, 0, 10000, 200);
  assert.equal(far.lat, 85);
  panGlobe(far, 0, -10000, 200);
  assert.equal(far.lat, -85);
  panGlobe(far, 100, 100, 0);
  assert.ok(Number.isFinite(far.lon));
  assert.equal(far.lat, -85);
});
