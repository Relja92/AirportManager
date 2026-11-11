import layout from './data/terrainTiles.js';
import {globeNightPoint, nightUV, nightRenderScale} from './nightLights.js';

export const TERRAIN_LAYOUT = layout;

// Smallest wrapped longitude interval containing a sampled region. Shared tile
// coordinates stay geographic, so imagery meets correctly across the dateline.
export function terrainTilesForPoints(points, capacity) {
  if (!points.length) return [];
  const us = points.map(p => p[0]).sort((a, b) => a - b);
  let gap = -1, start = 0, end = 1;
  for (let i = 0; i < us.length; i++) {
    const next = i + 1 < us.length ? us[i + 1] : us[0] + 1;
    if (next - us[i] > gap) {
      gap = next - us[i]; start = next % 1; end = us[i] + (us[i] < start ? 1 : 0);
    }
  }
  const minV = Math.min(...points.map(p => p[1])), maxV = Math.max(...points.map(p => p[1]));
  for (let level = layout.levels.length - 1; level >= 0; level--) {
    const {columns, rows} = layout.levels[level], tiles = [], seen = new Set();
    const firstRow = Math.min(rows - 1, Math.floor(minV * rows));
    const lastRow = Math.min(rows - 1, Math.floor(maxV * rows));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = Math.floor(start * columns); col <= Math.floor(end * columns); col++) {
        const id = `${level}/${col % columns}-${row}`;
        if (seen.has(id)) continue;
        seen.add(id);
        tiles.push({id,
          distance:Math.abs((col + 0.5) / columns - (start + end) / 2) + Math.abs((row + 0.5) / rows - (minV + maxV) / 2)});
      }
    }
    if (tiles.length <= capacity) return tiles.sort((a, b) => a.distance - b.distance).map(t => t.id);
  }
  return [];
}

export function visibleTerrainTiles(o, sourceWidth, capacity = 25) {
  if (2 * Math.PI * o.frame.R * nightRenderScale(o.width, o.height, o.dpr) < sourceWidth * 0.75) return [];
  const points = [];
  const sample = (x, y) => {
    const ll = globeNightPoint(x, y, o.frame);
    if (ll) points.push(nightUV(...ll));
  };
  for (let y = 0; y <= 24; y++) for (let x = 0; x <= 32; x++) sample(o.width * x / 32, o.height * y / 24);
  // Include the curved silhouette, which can lie between grid samples.
  for (let i = 0; i < 96; i++) {
    const a = i * Math.PI / 48, x = o.frame.cx + Math.cos(a) * o.frame.R * 0.999999;
    const y = o.frame.cy + Math.sin(a) * o.frame.R * 0.999999;
    if (x >= 0 && x <= o.width && y >= 0 && y <= o.height) sample(x, y);
  }
  // A visible pole contains every longitude; avoid a missing wedge at its tip.
  for (const pole of [-1, 1]) {
    const x = o.frame.cx + o.frame.R * o.frame.e[2] * pole;
    const y = o.frame.cy - o.frame.R * o.frame.n[2] * pole;
    if (o.frame.c[2] * pole > 0 && x >= 0 && x <= o.width && y >= 0 && y <= o.height) {
      for (let col = 0; col < 64; col++) points.push([col / 64, pole > 0 ? 0 : 1]);
    }
  }
  return terrainTilesForPoints(points, capacity);
}
