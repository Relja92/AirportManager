// Trackpads send two-finger swipes as pixel wheel events and pinches with
// ctrlKey. In the phone layout, swipes move the view; only pinches zoom it.
// Keep the existing wheel-to-zoom controls in the desktop layout.
export function wheelGesture({ deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false }, mobile) {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (!deltaX && !deltaY)) return null;
  if (mobile && deltaMode === 0 && !ctrlKey) return { kind: 'pan', dx: -deltaX, dy: -deltaY };
  if (!deltaY) return null;
  return { kind: 'zoom', factor: Math.exp(-deltaY * (ctrlKey ? 0.012 : 0.0018)) };
}

export function panGlobe(globe, dx, dy, radius) {
  if (!(radius > 0)) return;
  const perPx = 180 / Math.PI / radius;
  globe.lon -= dx * perPx;
  globe.lat = Math.max(-85, Math.min(85, globe.lat + dy * perPx));
}
