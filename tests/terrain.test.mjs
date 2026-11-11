import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {TERRAIN_LAYOUT, visibleTerrainTiles} from '../src/terrainTiles.js';
import {spherePoint, globeNightPoint, nightUV} from '../src/nightLights.js';

const frame = (lon, lat, R=4536) => {
  const l=lon*Math.PI/180,p=lat*Math.PI/180;
  return {cx:805,cy:395,R,c:spherePoint(lon,lat),e:[-Math.sin(l),Math.cos(l),0],
    n:[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)]};
};
test('close Earth views cover the whole visible region within the color tile budget', () => {
  for (const center of [[-0.45,51.47],[139.7,35.7],[179,40],[-179,-40],[0,88],[0,-88]]) {
    for (const capacity of [25,16,9,4]) {
      const o={width:1280,height:720,dpr:2,frame:frame(...center)};
      const ids=visibleTerrainTiles(o,8192,capacity), tiles=new Set(ids);
      if (Math.abs(center[1]) > 85 && capacity < 8) {
        assert.equal(tiles.size,0,'a tiny GPU keeps the full overview at the pole');
        continue;
      }
      assert.ok(tiles.size,`${center}, capacity ${capacity} has a detail level`);
      assert.equal(tiles.size,ids.length,'no duplicate dateline tiles');
      assert.ok(tiles.size<=capacity);
      const level=+ids[0].split('/')[0], {columns,rows}=TERRAIN_LAYOUT.levels[level];
      // Independent, denser sampling detects holes in the coverage selection.
      for (let y=0;y<=60;y++) for(let x=0;x<=80;x++) {
        const ll=globeNightPoint(x*o.width/80,y*o.height/60,o.frame);
        if(!ll) continue;
        const [u,v]=nightUV(...ll), id=`${level}/${Math.floor(u*columns)}-${Math.min(rows-1,Math.floor(v*rows))}`;
        assert.ok(tiles.has(id),`${center}, capacity ${capacity} is missing ${id}`);
      }
    }
  }
});
test('Earth overview avoids detail requests; maximum zoom reaches native 500 m imagery', () => {
  const o={width:1280,height:720,dpr:2,frame:frame(-0.45,51.47,280)};
  assert.deepEqual(visibleTerrainTiles(o,8192),[]);
  const ids=visibleTerrainTiles({...o,frame:frame(-0.45,51.47)},8192);
  assert.ok(ids.length);
  const level=+ids[0].split('/')[0];
  assert.equal(TERRAIN_LAYOUT.levels[level].columns*TERRAIN_LAYOUT.tileSize,86400);
  const mobile=visibleTerrainTiles({width:390,height:844,dpr:2,frame:{...frame(-0.45,51.47,2808),cx:195,cy:320}},4096);
  assert.equal(+mobile[0].split('/')[0],3);
});
test('every terrain pyramid tile and both overview images are bundled locally', async () => {
  const files=['earth-day.jpg','earth-day-mobile.jpg'];
  for (const [level,{columns,rows}] of TERRAIN_LAYOUT.levels.entries()) {
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)files.push(`terrain-tiles/${level}/${col}-${row}.jpg`);
  }
  await Promise.all(files.map(file=>access(new URL(`../public/textures/${file}`,import.meta.url))));
});
