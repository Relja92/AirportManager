// World map renderer: canvas, pan/zoom, airports, routes, planes.
import { geoNaturalEarth1, geoOrthographic, geoPath, geoGraticule10, geoInterpolate, geoCircle } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';
import world110 from 'world-atlas/countries-110m.json';
import { AIRPORTS, AIRPORT_BY_ID } from './data/airports.js';
import { AIRCRAFT } from './data/catalog.js';
import { EVENT_TYPES, isActive } from './events.js';
import { game, distKm } from './game.js';
import { companyColor, companySoft, companyInk } from './company.js';
import { rivalHubIds } from './rivals.js';
import { createNightLights, spherePoint } from './nightLights.js';
import { createEarthTerrain } from './earthTerrain.js';
import { wheelGesture, panGlobe } from './mapGestures.js';

const W = 2000, H = 1000; // world units the projection is fitted to
const C = {
  ocean: '#0b1826', land: '#16283a', coast: 'rgba(120,165,205,.28)', border: 'rgba(120,165,205,.11)',
  grat: 'rgba(160,200,235,.045)', amber: '#ffb454', amberSoft: 'rgba(255,180,84,',
  ambient: 'rgba(140,196,232,', dot: '#6d8ba6', text: '#c9d8e6', good: '#5fd69a', bad: '#ff7b6b',
};
const PLANE = new Path2D('M6 0L1 1.2L-1 5L-2.4 5L-1.2 1.2L-4.5 1L-5.6 2.6L-6.4 2.6L-5.8 0L-6.4-2.6L-5.6-2.6L-4.5-1L-1.2-1.2L-2.4-5L-1-5L1-1.2Z');
const AMBIENT_COUNT = 70;
const MAX_ZOOM = 40;

export function createMap(canvas, { onPick, onHover }) {
  const ctx = canvas.getContext('2d');
  const projection = geoNaturalEarth1().precision(0.1).fitExtent([[20, 20], [W - 20, H - 20]], { type: 'Sphere' });
  const pathGen = geoPath(projection);
  const P = (d) => new Path2D(pathGen(d));
  const spherePath = P({ type: 'Sphere' });
  const gratPath = P(geoGraticule10());
  const landPath = P(feature(world, world.objects.land));
  const borderPath = P(mesh(world, world.objects.countries, (a, b) => a !== b));

  const pos = {}; // airport id -> [wx, wy]
  for (const a of AIRPORTS) pos[a.id] = projection([a.lon, a.lat]);

  let cw = 0, ch = 0, dpr = 1, k0 = 1;
  const view = { k: 1, x: 0, y: 0 };
  let tween = null;
  let sel = null, hovered = null, showRivals = false, profitView = false;
  // Amber normally; in profit view, green or red by yesterday's result and grey with nothing to go on.
  function routeColor(r) {
    if (!profitView) return companySoft(game.state);
    const p = r.yesterday?.flights ? game.routeProfit(r) : null;
    return p == null ? 'rgba(170,185,200,' : p >= 0 ? 'rgba(95,214,154,' : 'rgba(255,123,107,';
  }
  let clock = 0; // real seconds, for pulses
  let planeHits = [];
  const floats = [];

  // ---------- geometry caches ----------
  const arcCache = new Map();
  function arc(aId, bId) {
    const key = `${aId}>${bId}`;
    let v = arcCache.get(key);
    if (!v) {
      const a = AIRPORT_BY_ID[aId], b = AIRPORT_BY_ID[bId];
      const A = [a.lon, a.lat], B = [b.lon, b.lat];
      v = { interp: geoInterpolate(A, B), path: P({ type: 'LineString', coordinates: [A, B] }), km: distKm(a, b) };
      arcCache.set(key, v);
    }
    return v;
  }
  // World position + heading at fraction f along an interpolator. Handles the antimeridian seam.
  function pose(interp, f) {
    const p = projection(interp(f));
    const ahead = f < 0.99;
    const q = projection(interp(ahead ? f + 0.006 : f - 0.006));
    let dx = q[0] - p[0], dy = q[1] - p[1];
    if (!ahead) { dx = -dx; dy = -dy; }
    if (Math.abs(dx) > W / 2) { // sample fell across the seam: look the other way
      const r = projection(interp(ahead ? Math.max(0, f - 0.006) : Math.min(1, f + 0.006)));
      dx = ahead ? p[0] - r[0] : r[0] - p[0];
      dy = ahead ? p[1] - r[1] : r[1] - p[1];
    }
    return { x: p[0], y: p[1], angle: Math.atan2(dy, dx) };
  }
  const sx = (wx) => wx * view.k + view.x;
  const sy = (wy) => wy * view.k + view.y;
  const onScreen = (px, py, m = 30) => px > -m && px < cw + m && py > -m && py < ch + m;

  // Shade the night side (game clock is UTC). Redrawn from the exact clock every frame so it
  // glides instead of stepping, and built from many thin bands so dusk and dawn fade gradually.
  const TWILIGHT = Array.from({ length: 26 }, (_, i) => 105 - i * 1.25); // 105° down to ~74°
  const nightCircle = geoCircle().precision(4);
  const drawGeo = geoPath(projection, ctx);
  function sunPosition(s) {
    const hours = (s.minute % 1440) / 60;
    return [(12 - hours) * 15, 23.44 * Math.sin((2 * Math.PI * ((s.minute / 1440) % 360 - 80)) / 360)];
  }
  function drawNight(s) {
    const [sunLon, sunLat] = sunPosition(s);
    nightCircle.center([sunLon + 180, -sunLat]);
    ctx.fillStyle = 'rgba(2,5,10,.019)';
    for (const r of TWILIGHT) {
      ctx.beginPath();
      drawGeo(nightCircle.radius(r)());
      ctx.fill();
    }
  }

  // Airport coordinates serve markers and hit testing; satellite lights are independent.
  const RAD = Math.PI / 180;
  const unit = spherePoint;
  const airportVectors = AIRPORTS.map(a => unit(a.lon, a.lat));
  const nightLights = createNightLights({projection});

  // ---------- ambient world traffic ----------
  const weighted = AIRPORTS.flatMap((a) => Array(a.size * a.size).fill(a));
  const pickAirport = () => weighted[(Math.random() * weighted.length) | 0];
  function newAmbient(from, randomProgress) {
    let a = from || pickAirport(), b = null;
    for (let i = 0; i < 30 && !b; i++) {
      const c = pickAirport();
      const d = c === a ? 0 : distKm(a, c);
      if (d > 350 && d < 12500) b = c;
    }
    if (!b) { a = AIRPORT_BY_ID.LHR; b = AIRPORT_BY_ID.JFK; }
    const dur = (distKm(a, b) / 850) * 60;
    return { to: b, interp: geoInterpolate([a.lon, a.lat], [b.lon, b.lat]), dur, t: randomProgress ? Math.random() * dur : 0 };
  }
  const ambient = Array.from({ length: AMBIENT_COUNT }, () => newAmbient(null, true));

  // ---------- view ----------
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const first = cw === 0;
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    k0 = Math.min(cw / W, ch / H);
    if (first) { view.k = k0; view.x = (cw - W * k0) / 2; view.y = (ch - H * k0) / 2; }
    clampView();
  }
  function clampView() {
    view.k = Math.min(k0 * MAX_ZOOM, Math.max(k0 * 0.9, view.k));
    const clampAxis = (v, size, screen) => {
      const span = size * view.k;
      if (span <= screen) return (screen - span) / 2;
      return Math.min(screen * 0.35, Math.max(screen * 0.65 - span, v));
    };
    view.x = clampAxis(view.x, W, cw);
    view.y = clampAxis(view.y, H, ch);
  }
  function zoomAt(px, py, factor) {
    const k = Math.min(k0 * MAX_ZOOM, Math.max(k0 * 0.9, view.k * factor));
    const f = k / view.k;
    view.x = px - (px - view.x) * f;
    view.y = py - (py - view.y) * f;
    view.k = k;
    clampView();
  }
  // The interface tells us which part of the map nothing covers, so a focused airport never hides under its own card.
  let free = null, gc = null;
  function freeCentre() {
    if (free && free.x1 - free.x0 > 140 && free.y1 - free.y0 > 140) return [(free.x0 + free.x1) / 2, (free.y0 + free.y1) / 2];
    const wide = cw > 760;
    const left = wide ? 340 : 0;
    return [left + (cw - left) / 2, wide ? ch / 2 + 30 : ch * 0.33];
  }
  function focus(id, zoom = 4) {
    const p = pos[id];
    if (!p) return;
    if (mode === 'globe') {
      const a = AIRPORT_BY_ID[id];
      gtween = { lon: a.lon, lat: Math.max(-80, Math.min(80, a.lat)), z: Math.max(globe.z, zoom * 0.55) };
      return;
    }
    const k = Math.max(view.k, k0 * zoom);
    const [fx, fy] = freeCentre(); // the middle of the map left uncovered by the panel and the card
    tween = { k, x: fx - p[0] * k, y: fy - p[1] * k };
  }
  function fit() {
    if (mode === 'globe') { gtween = { lon: globe.lon, lat: 20, z: 1 }; return; }
    tween = { k: k0, x: (cw - W * k0) / 2, y: (ch - H * k0) / 2 };
  }

  // ---------- input ----------
  function airportAt(px, py) {
    let best = null, bestD = 14 * 14;
    const g = mode === 'globe' ? gframe() : null;
    for (let i = 0; i < AIRPORTS.length; i++) {
      const a = AIRPORTS[i];
      let x, y;
      if (g) {
        const q = gp(airportVectors[i], g);
        if (q[2] <= 0.03) continue; // on the far side of the planet
        x = q[0]; y = q[1];
      } else { x = sx(pos[a.id][0]); y = sy(pos[a.id][1]); }
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }
  function planeAt(px, py) {
    let best = null, bestD = 13 * 13;
    for (const h of planeHits) {
      const d = (h.x - px) ** 2 + (h.y - py) ** 2;
      if (d < bestD) { bestD = d; best = h.id; }
    }
    return best;
  }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pointers = new Map();
  let drag = null, pinch = null;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    tween = null; gtween = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      drag = null;
    } else if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, glon: globe.lon, glat: globe.lat, moved: false };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [px, py]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (mode === 'globe') { if (pinch.d > 0) gzoom(d / pinch.d); }
      else {
        view.x += mx - pinch.mx; view.y += my - pinch.my;
        if (pinch.d > 0) zoomAt(mx, my, d / pinch.d);
      }
      pinch = { d, mx, my };
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      if (drag.moved && mode === 'globe') { // spin the planet under the pointer
        const perPx = 180 / Math.PI / gframe().R;
        globe.lon = drag.glon - dx * perPx;
        globe.lat = Math.max(-85, Math.min(85, drag.glat + dy * perPx));
      } else if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; clampView(); }
    }
    const a = drag?.moved ? null : airportAt(px, py);
    hovered = a;
    const overPlane = !a && !drag?.moved && planeAt(px, py) != null;
    canvas.style.cursor = drag?.moved ? 'grabbing' : a || overPlane ? 'pointer' : 'grab';
    onHover(e.pointerType === 'touch' ? null : a, e.clientX, e.clientY);
  });
  function release(e) {
    const wasPinch = !!pinch;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && !wasPinch && e.type === 'pointerup') {
      const [px, py] = local(e);
      const a = airportAt(px, py);
      const planeId = a ? null : planeAt(px, py);
      onPick(a ? { kind: 'airport', id: a.id } : planeId != null ? { kind: 'plane', id: planeId } : null);
    }
    if (!pointers.size) drag = null;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { hovered = null; onHover(null); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const gesture = wheelGesture(e, window.innerWidth <= 760);
    if (!gesture) return;
    tween = null; gtween = null;
    if (gesture.kind === 'pan') {
      if (mode === 'globe') panGlobe(globe, gesture.dx, gesture.dy, gframe().R);
      else { view.x += gesture.dx; view.y += gesture.dy; clampView(); }
    } else {
      const [px, py] = local(e);
      if (mode === 'globe') gzoom(gesture.factor);
      else zoomAt(px, py, gesture.factor);
    }
    hovered = null; onHover(null);
  }, { passive: false });
  window.addEventListener('resize', resize);
  resize();

  // ---------- update ----------
  function update(dtMin, real) {
    clock += real;
    for (let i = 0; i < ambient.length; i++) {
      const p = ambient[i];
      p.t += dtMin;
      if (p.t >= p.dur) ambient[i] = newAmbient(p.to, false);
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].age += real;
      if (floats[i].age > 1.8) floats.splice(i, 1);
    }
    if (gtween) {
      const a = 1 - Math.exp(-real * 4.5);
      const dLon = ((gtween.lon - globe.lon + 540) % 360) - 180; // turn the short way round
      globe.lon += dLon * a;
      globe.lat += (gtween.lat - globe.lat) * a;
      globe.z += (gtween.z - globe.z) * a;
      if (Math.abs(dLon) < 0.05 && Math.abs(gtween.lat - globe.lat) < 0.05 && Math.abs(gtween.z - globe.z) < 0.005) gtween = null;
    }
    if (tween) {
      const a = 1 - Math.exp(-real * 5);
      view.k += (tween.k - view.k) * a;
      view.x += (tween.x - view.x) * a;
      view.y += (tween.y - view.y) * a;
      if (Math.abs(tween.k - view.k) < view.k * 0.002 && Math.abs(tween.x - view.x) < 0.5 && Math.abs(tween.y - view.y) < 0.5) tween = null;
    }
  }

  function addFloat(airportId, text, good) {
    const p = pos[airportId];
    if (p && floats.length < 40) floats.push({ id: airportId, wx: p[0], wy: p[1], text, good, age: 0 });
  }

  // ---------- draw ----------
  function drawPlane(x, y, angle, scale, fill, stroke) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.fillStyle = fill;
    ctx.fill(PLANE);
    if (stroke) { ctx.lineWidth = 0.8 / scale; ctx.strokeStyle = stroke; ctx.stroke(PLANE); }
    ctx.restore();
  }
  function drawTrail(interp, f, length, rgbaPrefix, alpha, width) {
    const steps = 10;
    let prev = null;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    for (let i = 0; i <= steps; i++) {
      const ff = f - (length * i) / steps;
      if (ff < 0) break;
      const w = projection(interp(ff));
      const cur = [sx(w[0]), sy(w[1])];
      if (prev && Math.abs(cur[0] - prev[0]) < cw / 2) {
        ctx.strokeStyle = `${rgbaPrefix}${(alpha * (1 - i / steps)).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(cur[0], cur[1]); ctx.stroke();
      }
      prev = cur;
    }
  }
  function label(text, x, y, color, bold) {
    ctx.font = `${bold ? '600 ' : ''}10.5px "SF Mono", ui-monospace, Menlo, monospace`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(6,11,18,.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function draw() {
    if (cw <= 0 || ch <= 0) return; // A hidden/resizing browser surface can briefly have no pixels.
    if (mode === 'globe') { drawGlobe(); return; }
    const s = game.state;
    const { k, x, y } = view;
    const zoom = k / k0;
    const selAirport = sel?.kind === 'airport' ? sel.id : sel?.kind === 'route' ? game.route(sel.id)?.dest ?? null : null;
    const selPlane = sel?.kind === 'plane' ? sel.id : null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // --- world-space layers ---
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    ctx.fillStyle = C.ocean; ctx.fill(spherePath);
    ctx.lineWidth = 1 / k; ctx.strokeStyle = C.grat; ctx.stroke(gratPath);
    ctx.fillStyle = C.land; ctx.fill(landPath);
    ctx.lineWidth = 0.7 / k; ctx.strokeStyle = C.border; ctx.stroke(borderPath);
    ctx.lineWidth = 0.8 / k; ctx.strokeStyle = C.coast; ctx.stroke(landPath);
    if (s) {
      ctx.save(); ctx.clip(spherePath);
      drawNight(s);
      ctx.restore();
    }
    ctx.lineWidth = 1 / k; ctx.strokeStyle = 'rgba(120,165,205,.2)'; ctx.stroke(spherePath);

    const dests = new Set();
    const hubs = new Set(s ? s.hubs.map((h) => h.id) : []);
    const rivalHubs = new Map(s ? s.rivals.flatMap((r) => rivalHubIds(r).map((id) => [id, r])) : []);
    const marks = new Map(); // airport id -> event currently happening there
    const jobs = new Map(s ? s.contracts.map((c) => [c.dest, c]) : []); // airport id -> contract that sends you there
    if (s) {
      for (const e of s.events) if (e.airport && isActive(e, s.day) && !(e.type === 'strike' && e.settled)) marks.set(e.airport, e);
      ctx.lineCap = 'round';
      if (showRivals) {
        for (const rv of s.rivals) {
          ctx.strokeStyle = rv.color; ctx.globalAlpha = 0.4; ctx.lineWidth = 1 / k;
          for (const rr of rv.routes) ctx.stroke(arc(rr.hub || rv.hub, rr.dest).path);
        }
        ctx.globalAlpha = 1;
      }
      for (const r of s.routes) {
        dests.add(r.dest);
        const hot = (r.dest === selAirport && (r.hub === s.active || !hubs.has(selAirport))) || r.dest === hovered?.id;
        const dim = r.hub !== s.active && s.hubs.length > 1 ? 0.7 : 1;
        const p = arc(r.hub, r.dest).path;
        const col = routeColor(r);
        ctx.lineWidth = (hot ? 5 : 4) / k; ctx.strokeStyle = `${col}${hot ? 0.2 : profitView ? 0.16 : 0.09})`; ctx.stroke(p);
        ctx.lineWidth = (hot ? 1.6 : profitView ? 1.4 : 1.1) / k; ctx.strokeStyle = `${col}${hot ? 0.95 : profitView ? 0.85 : 0.55 * dim})`; ctx.stroke(p);
      }
      // Preview arc from the active hub to a selected airport it doesn't serve yet.
      if (selAirport && selAirport !== s.active && !game.routeTo(s.active, selAirport)) {
        ctx.setLineDash([5 / k, 5 / k]);
        ctx.lineWidth = 1.2 / k; ctx.strokeStyle = 'rgba(201,216,230,.6)';
        ctx.stroke(arc(s.active, selAirport).path);
        ctx.setLineDash([]);
      }
    }

    // --- screen-space layers ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s) nightLights.drawFlat(ctx, {width:cw, height:ch, dpr, view, sun:unit(...sunPosition(s))});

    const ambScale = Math.min(0.85, 0.42 + zoom * 0.05);
    for (const p of ambient) {
      const f = p.t / p.dur;
      const ps = pose(p.interp, f);
      const px = sx(ps.x), py = sy(ps.y);
      if (!onScreen(px, py, 20)) continue;
      drawTrail(p.interp, f, Math.min(0.12, 260 / (p.dur * 14)), C.ambient, 0.28, 1);
      drawPlane(px, py, ps.angle, ambScale, `${C.ambient}.6)`);
    }

    // rival aircraft shuttle along their routes; no saved state needed, just the clock
    if (s) {
      for (const rv of s.rivals) {
        rv.routes.forEach((rr, i) => {
          const out = arc(rr.hub || rv.hub, rr.dest);
          const dur = (out.km / 850) * 60 + 40;
          const ph = ((s.minute + i * 137 + rv.id * 411) / dur) % 2;
          const a = ph < 1 ? out : arc(rr.dest, rr.hub || rv.hub);
          const ps = pose(a.interp, Math.min(0.999, ph < 1 ? ph : ph - 1));
          const px = sx(ps.x), py = sy(ps.y);
          if (onScreen(px, py, 20)) drawPlane(px, py, ps.angle, ambScale * 1.25, rv.color, 'rgba(10,16,24,.7)');
        });
      }
    }

    // airports
    for (const a of AIRPORTS) {
      const px = sx(pos[a.id][0]), py = sy(pos[a.id][1]);
      if (!onScreen(px, py)) continue;
      const isHub = hubs.has(a.id);
      const isDest = dests.has(a.id);
      const rival = rivalHubs.get(a.id);
      const isHover = hovered === a, isSel = selAirport === a.id;
      const r = (1.3 + a.size * 0.45) * Math.min(1.8, 0.8 + zoom * 0.08);
      if (isHub) {
        if (a.id === s.active) {
          const pulse = (clock * 0.6) % 1;
          ctx.beginPath(); ctx.arc(px, py, 6 + pulse * 16, 0, 7);
          ctx.strokeStyle = `${companySoft(game.state)}${(0.55 * (1 - pulse)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 7); ctx.fillStyle = companyColor(game.state); ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fillStyle = '#10161f'; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(px, py, r + (isDest ? 0.8 : 0), 0, 7);
        ctx.fillStyle = isDest ? companyColor(game.state) : isHover || isSel ? '#e8f1f8' : C.dot;
        ctx.fill();
        if (rival) {
          ctx.beginPath(); ctx.arc(px, py, r + 3.5, 0, 7);
          ctx.strokeStyle = rival.color; ctx.lineWidth = 1.6; ctx.stroke();
        }
      }
      if (isSel || isHover) {
        ctx.beginPath(); ctx.arc(px, py, (isHub ? 9 : r + (rival ? 7 : 5)), 0, 7);
        ctx.strokeStyle = isSel ? '#e8f1f8' : 'rgba(232,241,248,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      const job = jobs.get(a.id);
      if (job) { // contract destination: a green beacon, solid once signed
        const pulse = (clock * 0.45) % 1;
        ctx.beginPath(); ctx.arc(px, py, r + 4 + pulse * 12, 0, 7);
        ctx.strokeStyle = `rgba(95,214,154,${(0.7 * (1 - pulse)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, r + 3.5, 0, 7);
        ctx.setLineDash(job.due == null ? [3, 3] : []); ctx.strokeStyle = '#5fd69a'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
        ctx.textAlign = 'center';
        label('◆', px, py - (isHub ? 11 : r + 7) - (marks.has(a.id) ? 12 : 0), '#5fd69a', true);
        ctx.textAlign = 'left';
      }
      const mark = marks.get(a.id);
      if (mark) {
        const t = EVENT_TYPES[mark.type];
        ctx.textAlign = 'center';
        label(t.icon, px, py - (isHub ? 11 : r + 6), t.color, true);
        ctx.textAlign = 'left';
      }
      const showLabel = isHub || isDest || isHover || isSel || job || rival || mark || zoom > [0, 7, 5.5, 3.6, 2.4, 1.5][a.size];
      if (showLabel) label(a.id, px + (isHub ? 10 : r + (rival ? 7 : 5)), py + 3.5, isHub || isDest ? companyColor(game.state) : job ? '#5fd69a' : rival ? rival.color : C.text, isHub || isDest || !!job);
    }

    // player aircraft
    planeHits = [];
    if (s) {
      for (const p of s.planes) {
        if (p.phase !== 'out' && p.phase !== 'back') continue;
        const route = game.route(p.routeId);
        if (!route) continue;
        const a = p.phase === 'out' ? arc(route.hub, route.dest) : arc(route.dest, route.hub);
        const f = Math.min(1, p.t / p.dur);
        const ps = pose(a.interp, f);
        const px = sx(ps.x), py = sy(ps.y);
        drawTrail(a.interp, f, Math.min(0.35, 500 / route.km), 'rgba(255,214,150,', 0.85, 1.8);
        const scale = (0.95 + AIRCRAFT[p.type].cls * 0.14) * Math.min(1.5, 0.85 + zoom * 0.06);
        if (p.id === selPlane) {
          ctx.beginPath(); ctx.arc(px, py, 13, 0, 7);
          ctx.strokeStyle = '#e8f1f8'; ctx.lineWidth = 1.2; ctx.stroke();
        }
        drawPlane(px, py, ps.angle, scale, companyInk(game.state), 'rgba(10,16,24,.9)');
        planeHits.push({ id: p.id, x: px, y: py });
      }
    }

    // floating income text
    ctx.textAlign = 'center';
    for (const f of floats) {
      const a = Math.min(1, (1.8 - f.age) / 0.6);
      ctx.globalAlpha = Math.max(0, a);
      label(f.text, sx(f.wx), sy(f.wy) - 12 - f.age * 16, f.good ? C.good : C.bad, true);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // ---------- Earth view: a globe you can spin ----------
  // Same game, same data; only the projection and the styling differ from the flat chart.
  let mode = 'flat';
  try { if (localStorage.getItem('airport-manager-view') === 'globe') mode = 'globe'; } catch { /* ignore */ }
  const globe = { lon: 15, lat: 25, z: 1 }; // centre of the visible side, and zoom
  let gtween = null;
  const GLOBE_ZOOM = [0.7, 16];
  const ortho = geoOrthographic().clipAngle(90).precision(0.4);
  const orthoPath = geoPath(ortho, ctx);
  const base = document.createElement('canvas'); // ocean, land and atmosphere, redrawn only when the view changes
  const bctx = base.getContext('2d');
  const basePath = geoPath(ortho, bctx);
  const land110 = feature(world110, world110.objects.land);
  const land50 = feature(world, world.objects.land);
  const borders110 = mesh(world110, world110.objects.countries, (a, b) => a !== b);
  const stars = Array.from({ length: 170 }, () => [Math.random(), Math.random(), 0.15 + Math.random() * 0.55]);
  let baseKey = '', lastSig = '', lastMove = 0;

  // The overview stays available while progressively sharper satellite tiles load.
  // If WebGL or the imagery is unavailable, keep the painted globe fallback.
  const tex = createEarthTerrain();

  function gzoom(f) { globe.z = Math.max(GLOBE_ZOOM[0], Math.min(GLOBE_ZOOM[1], globe.z * f)); }
  // Where the globe sits on screen, and the three axes used to project points onto it.
  function gframe() {
    const wide = cw > 760;
    const left = wide ? 340 : 0;
    const R = Math.min(cw - left, wide ? ch - 90 : ch * 0.6) * 0.45 * globe.z;
    const l = globe.lon * RAD, p = globe.lat * RAD;
    return {
      R, cx: (gc || freeCentre())[0], cy: (gc || freeCentre())[1],
      c: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
      e: [-Math.sin(l), Math.cos(l), 0],
      n: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    };
  }
  // Unit vector -> [screen x, screen y, depth]. Depth above 0 means the point faces the viewer.
  const gp = (v, g) => [
    g.cx + g.R * (v[0] * g.e[0] + v[1] * g.e[1]),
    g.cy - g.R * (v[0] * g.n[0] + v[1] * g.n[1] + v[2] * g.n[2]),
    v[0] * g.c[0] + v[1] * g.c[1] + v[2] * g.c[2],
  ];
  const gll = (ll, g) => gp(unit(ll[0], ll[1]), g);
  function gpose(interp, f, g) {
    const a = gll(interp(f), g);
    if (a[2] <= 0.03) return null;
    const ahead = f < 0.99;
    const b = gll(interp(ahead ? f + 0.006 : f - 0.006), g);
    const sgn = ahead ? 1 : -1;
    return { x: a[0], y: a[1], angle: Math.atan2((b[1] - a[1]) * sgn, (b[0] - a[0]) * sgn) };
  }
  function gtrail(interp, f, length, rgbaPrefix, alpha, width, g) {
    const steps = 10;
    let prev = null;
    ctx.lineWidth = width; ctx.lineCap = 'round';
    for (let i = 0; i <= steps; i++) {
      const ff = f - (length * i) / steps;
      if (ff < 0) break;
      const cur = gll(interp(ff), g);
      if (prev && prev[2] > 0 && cur[2] > 0) {
        ctx.strokeStyle = `${rgbaPrefix}${(alpha * (1 - i / steps)).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(cur[0], cur[1]); ctx.stroke();
      }
      prev = cur;
    }
  }
  const line = (aId, bId) => {
    const a = AIRPORT_BY_ID[aId], b = AIRPORT_BY_ID[bId];
    return { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] };
  };
  const stroke = (geo) => { ctx.beginPath(); orthoPath(geo); ctx.stroke(); };

  function renderBase(g, detail) {
    if (base.width !== canvas.width || base.height !== canvas.height) { base.width = canvas.width; base.height = canvas.height; }
    const b = bctx;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.clearRect(0, 0, cw, ch);
    for (const st of stars) { b.fillStyle = `rgba(205,222,255,${st[2]})`; b.fillRect(st[0] * cw, st[1] * ch, 1.1, 1.1); }
    const disc = () => { b.beginPath(); b.arc(g.cx, g.cy, g.R, 0, 7); b.fill(); };
    let grad = b.createRadialGradient(g.cx, g.cy, g.R * 0.97, g.cx, g.cy, g.R * 1.15); // atmosphere
    grad.addColorStop(0, 'rgba(120,185,255,.45)'); grad.addColorStop(0.3, 'rgba(95,155,255,.16)'); grad.addColorStop(1, 'rgba(95,155,255,0)');
    b.fillStyle = grad; b.beginPath(); b.arc(g.cx, g.cy, g.R * 1.15, 0, 7); b.fill();
    if (tex?.ready) {
      tex.render({frame:g,width:cw,height:ch,dpr});
      b.drawImage(tex.cv, 0, 0, cw, ch);
      b.beginPath(); basePath(borders110); // faint borders only; the photo already shows the coasts
      b.lineWidth = 0.6; b.strokeStyle = 'rgba(255,255,255,.13)'; b.stroke();
    } else {
      grad = b.createRadialGradient(g.cx - g.R * 0.25, g.cy - g.R * 0.3, g.R * 0.1, g.cx, g.cy, g.R); // ocean
      grad.addColorStop(0, '#1f568a'); grad.addColorStop(1, '#0a2242');
      b.fillStyle = grad; disc();
      b.beginPath(); basePath(detail === 'hi' ? land50 : land110);
      b.fillStyle = '#2e5c48'; b.fill();
      b.lineWidth = 0.8; b.strokeStyle = 'rgba(175,228,198,.3)'; b.stroke();
      b.beginPath(); basePath(borders110);
      b.lineWidth = 0.6; b.strokeStyle = 'rgba(215,238,224,.11)'; b.stroke();
    }
    grad = b.createRadialGradient(g.cx, g.cy, g.R * 0.55, g.cx, g.cy, g.R); // darker toward the edge, so it reads as a ball
    grad.addColorStop(0, 'rgba(0,4,12,0)'); grad.addColorStop(1, `rgba(0,4,12,${tex?.ready ? 0.42 : 0.5})`);
    b.fillStyle = grad; disc();
  }

  function drawGlobe() {
    const s = game.state;
    // Slide the globe toward the middle of the uncovered area rather than jumping when a card opens.
    const fc = freeCentre();
    if (!gc || Math.hypot(fc[0] - gc[0], fc[1] - gc[1]) > 600) gc = fc;
    else { gc[0] += (fc[0] - gc[0]) * 0.12; gc[1] += (fc[1] - gc[1]) * 0.12; }
    const g = gframe();
    const zoom = globe.z * 1.3; // rough equivalent of the flat map's zoom, for label and marker sizes
    const selAirport = sel?.kind === 'airport' ? sel.id : sel?.kind === 'route' ? game.route(sel.id)?.dest ?? null : null;
    const selPlane = sel?.kind === 'plane' ? sel.id : null;
    ortho.translate([g.cx, g.cy]).scale(g.R).rotate([-globe.lon, -globe.lat]);

    // Coarse coastlines while spinning, fine ones once the globe has been still for a moment.
    const sig = `${globe.lon.toFixed(3)}|${globe.lat.toFixed(3)}|${g.R.toFixed(1)}|${cw}|${ch}|${dpr}`;
    if (sig !== lastSig) { lastSig = sig; lastMove = clock; }
    const detail = clock - lastMove > 0.3 && globe.z > 1.3 ? 'hi' : 'lo';
    tex.prepare({frame:g,width:cw,height:ch,dpr},sig);
    const terrainKey = sig + detail + '|' + tex.revision;
    if (baseKey !== terrainKey || tex.animating) { baseKey = terrainKey; renderBase(g, detail); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dests = new Set();
    const hubs = new Set(s ? s.hubs.map((h) => h.id) : []);
    const rivalHubs = new Map(s ? s.rivals.flatMap((r) => rivalHubIds(r).map((id) => [id, r])) : []);
    const marks = new Map();
    const jobs = new Map(s ? s.contracts.map((c) => [c.dest, c]) : []);
    if (s) {
      const [sunLon, sunLat] = sunPosition(s);
      if (!nightLights.drawGlobe(ctx, {width:cw, height:ch, dpr, frame:g, sun:unit(sunLon, sunLat)})) {
        // Keep the night side dark while the satellite image loads, or if it fails.
        nightCircle.center([sunLon + 180, -sunLat]);
        ctx.fillStyle = 'rgba(1,3,9,.103)';
        for (const r of TWILIGHT) { ctx.beginPath(); orthoPath(nightCircle.radius(r)()); ctx.fill(); }
      }

      for (const e of s.events) if (e.airport && isActive(e, s.day) && !(e.type === 'strike' && e.settled)) marks.set(e.airport, e);
      ctx.lineCap = 'round';
      if (showRivals) {
        ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
        for (const rv of s.rivals) { ctx.strokeStyle = rv.color; for (const rr of rv.routes) stroke(line(rr.hub || rv.hub, rr.dest)); }
        ctx.globalAlpha = 1;
      }
      for (const r of s.routes) {
        dests.add(r.dest);
        const hot = (r.dest === selAirport && (r.hub === s.active || !hubs.has(selAirport))) || r.dest === hovered?.id;
        const geo = line(r.hub, r.dest);
        const col = routeColor(r);
        ctx.lineWidth = hot ? 5 : 4; ctx.strokeStyle = `${col}${hot ? 0.22 : profitView ? 0.18 : 0.1})`; stroke(geo);
        ctx.lineWidth = hot ? 1.7 : profitView ? 1.5 : 1.2; ctx.strokeStyle = `${col}${hot ? 0.95 : profitView ? 0.9 : 0.65})`; stroke(geo);
      }
      if (selAirport && selAirport !== s.active && !game.routeTo(s.active, selAirport)) {
        ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(225,235,245,.7)';
        stroke(line(s.active, selAirport));
        ctx.setLineDash([]);
      }
    }

    const ambScale = Math.min(0.85, 0.45 + zoom * 0.05);
    for (const p of ambient) {
      const f = p.t / p.dur;
      const ps = gpose(p.interp, f, g);
      if (!ps || !onScreen(ps.x, ps.y, 20)) continue;
      gtrail(p.interp, f, Math.min(0.12, 260 / (p.dur * 14)), 'rgba(190,225,250,', 0.3, 1, g);
      drawPlane(ps.x, ps.y, ps.angle, ambScale, 'rgba(190,225,250,.7)');
    }
    if (s) {
      for (const rv of s.rivals) {
        rv.routes.forEach((rr, i) => {
          const out = arc(rr.hub || rv.hub, rr.dest);
          const dur = (out.km / 850) * 60 + 40;
          const ph = ((s.minute + i * 137 + rv.id * 411) / dur) % 2;
          const a = ph < 1 ? out : arc(rr.dest, rr.hub || rv.hub);
          const ps = gpose(a.interp, Math.min(0.999, ph < 1 ? ph : ph - 1), g);
          if (ps && onScreen(ps.x, ps.y, 20)) drawPlane(ps.x, ps.y, ps.angle, ambScale * 1.25, rv.color, 'rgba(10,16,24,.7)');
        });
      }
    }

    for (let i = 0; i < AIRPORTS.length; i++) {
      const a = AIRPORTS[i];
      const q = gp(airportVectors[i], g);
      if (q[2] <= 0.03 || !onScreen(q[0], q[1])) continue;
      const px = q[0], py = q[1];
      const isHub = hubs.has(a.id), isDest = dests.has(a.id), rival = rivalHubs.get(a.id);
      const isHover = hovered === a, isSel = selAirport === a.id;
      const r = (1.3 + a.size * 0.45) * Math.min(1.8, 0.8 + zoom * 0.08);
      if (isHub) {
        if (a.id === s.active) {
          const pulse = (clock * 0.6) % 1;
          ctx.beginPath(); ctx.arc(px, py, 6 + pulse * 16, 0, 7);
          ctx.strokeStyle = `${companySoft(game.state)}${(0.55 * (1 - pulse)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 7); ctx.fillStyle = companyColor(game.state); ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fillStyle = '#10161f'; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(px, py, r + (isDest ? 0.8 : 0), 0, 7);
        ctx.fillStyle = isDest ? companyColor(game.state) : isHover || isSel ? '#ffffff' : 'rgba(215,232,245,.8)';
        ctx.fill();
        if (rival) { ctx.beginPath(); ctx.arc(px, py, r + 3.5, 0, 7); ctx.strokeStyle = rival.color; ctx.lineWidth = 1.6; ctx.stroke(); }
      }
      if (isSel || isHover) {
        ctx.beginPath(); ctx.arc(px, py, (isHub ? 9 : r + (rival ? 7 : 5)), 0, 7);
        ctx.strokeStyle = isSel ? '#ffffff' : 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      const job = jobs.get(a.id);
      if (job) { // contract destination: a green beacon, solid once signed
        const pulse = (clock * 0.45) % 1;
        ctx.beginPath(); ctx.arc(px, py, r + 4 + pulse * 12, 0, 7);
        ctx.strokeStyle = `rgba(95,214,154,${(0.7 * (1 - pulse)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, r + 3.5, 0, 7);
        ctx.setLineDash(job.due == null ? [3, 3] : []); ctx.strokeStyle = '#5fd69a'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
        ctx.textAlign = 'center';
        label('◆', px, py - (isHub ? 11 : r + 7) - (marks.has(a.id) ? 12 : 0), '#5fd69a', true);
        ctx.textAlign = 'left';
      }
      const mark = marks.get(a.id);
      if (mark) {
        const t = EVENT_TYPES[mark.type];
        ctx.textAlign = 'center';
        label(t.icon, px, py - (isHub ? 11 : r + 6), t.color, true);
        ctx.textAlign = 'left';
      }
      // Near the edge of the disc everything bunches up, so only label what the player cares about there.
      const showLabel = isHub || isDest || isHover || isSel || job || ((rival || mark || zoom > [0, 7, 5.5, 3.6, 2.4, 1.5][a.size]) && q[2] > 0.35);
      if (showLabel) label(a.id, px + (isHub ? 10 : r + (rival ? 7 : 5)), py + 3.5, isHub || isDest ? companyColor(game.state) : job ? '#5fd69a' : rival ? rival.color : '#e4eef6', isHub || isDest || !!job);
    }

    planeHits = [];
    if (s) {
      for (const p of s.planes) {
        if (p.phase !== 'out' && p.phase !== 'back') continue;
        const route = game.route(p.routeId);
        if (!route) continue;
        const a = p.phase === 'out' ? arc(route.hub, route.dest) : arc(route.dest, route.hub);
        const f = Math.min(1, p.t / p.dur);
        const ps = gpose(a.interp, f, g);
        if (!ps) continue;
        gtrail(a.interp, f, Math.min(0.35, 500 / route.km), 'rgba(255,214,150,', 0.9, 1.8, g);
        const scale = (0.95 + AIRCRAFT[p.type].cls * 0.14) * Math.min(1.5, 0.85 + zoom * 0.06);
        if (p.id === selPlane) { ctx.beginPath(); ctx.arc(ps.x, ps.y, 13, 0, 7); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke(); }
        drawPlane(ps.x, ps.y, ps.angle, scale, companyInk(game.state), 'rgba(10,16,24,.9)');
        planeHits.push({ id: p.id, x: ps.x, y: ps.y });
      }
    }

    ctx.textAlign = 'center';
    for (const f of floats) {
      const q = gp(airportVectors[AIRPORT_INDEX[f.id]], g);
      if (q[2] <= 0) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, (1.8 - f.age) / 0.6));
      label(f.text, q[0], q[1] - 12 - f.age * 16, f.good ? C.good : C.bad, true);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
  const AIRPORT_INDEX = Object.fromEntries(AIRPORTS.map((a, i) => [a.id, i]));

  function setMode(next) {
    mode = next === 'globe' ? 'globe' : 'flat';
    if (mode === 'flat') tex.suspend();
    try { localStorage.setItem('airport-manager-view', mode); } catch { /* ignore */ }
    tween = null; gtween = null; hovered = null;
    const s = game.state;
    if (mode === 'globe' && s) { const a = AIRPORT_BY_ID[s.active]; globe.lon = a.lon; globe.lat = Math.max(-60, Math.min(60, a.lat)); }
  }

  return {
    update, draw, focus, fit, addFloat, canvas,
    zoomBy: (f) => (mode === 'globe' ? gzoom(f) : zoomAt(cw / 2, ch / 2, f)),
    setMode, getMode: () => mode,
    setSelected: (v) => { sel = v; },
    setShowRivals: (v) => { showRivals = v; },
    setProfitView: (v) => { profitView = v; },
    setFree: (r) => { free = r; },
  };
}
