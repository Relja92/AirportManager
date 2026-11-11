import test from 'node:test';
import assert from 'node:assert/strict';
import {geoNaturalEarth1} from 'd3-geo';
import {access} from 'node:fs/promises';
import {flatNightPoint, globeNightPoint, spherePoint, nightOpacity, nightUV, globeNightShade, nightRenderScale, visibleNightTiles} from '../src/nightLights.js';
import {NIGHT_TILE_LEVELS, NIGHT_TILE_SIZE, nightTileInfo} from '../src/nightTileAtlas.js';

test('night-light pixels align with the actual flat map projection at cities and the dateline', () => {
  const p=geoNaturalEarth1().fitExtent([[20,20],[1980,980]],{type:'Sphere'});
  for (const ll of [[-0.4543,51.47],[31.2,30.0],[-74,40.7],[139.7,35.7],[151.2,-33.9],[-179.9,-16.5],[179.9,66],[-179,89],[0,-89]]) {
    const out=flatNightPoint(...p(ll),p.translate(),p.scale());
    assert.ok(out,`${ll} is on the map`);
    assert.ok(Math.abs(out[0]-ll[0])<1e-5,`${ll} longitude`);
    assert.ok(Math.abs(out[1]-ll[1])<1e-5,`${ll} latitude`);
  }
});
test('map pixels outside the curved world boundary are transparent', () => {
  const p=geoNaturalEarth1().fitExtent([[20,20],[1980,980]],{type:'Sphere'});
  for (const point of [[0,0],[0,500],[2000,500],[1000,-100],[1000,1100]]) assert.equal(flatNightPoint(...point,p.translate(),p.scale()),null);
});
const frame=(lon,lat)=>{
  const l=lon*Math.PI/180,p=lat*Math.PI/180;
  return {cx:400,cy:300,R:250,c:spherePoint(lon,lat),e:[-Math.sin(l),Math.cos(l),0],n:[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)]};
};
test('globe sampling tracks rotation, north/south orientation and the globe limb', () => {
  for (const center of [[0,0],[15,45],[170,-25],[-120,60]]) {
    const g=frame(...center);
    assert.deepEqual(globeNightPoint(g.cx,g.cy,g).map(v=>Math.round(v*1e6)/1e6),center);
    const ll=[center[0]+10,center[1]+5],v=spherePoint(...ll),dot=a=>v.reduce((sum,n,i)=>sum+n*a[i],0);
    const out=globeNightPoint(g.cx+g.R*dot(g.e),g.cy-g.R*dot(g.n),g);
    assert.ok(Math.abs(out[0]-ll[0])<1e-6); assert.ok(Math.abs(out[1]-ll[1])<1e-6);
    assert.equal(globeNightPoint(g.cx+g.R+1,g.cy,g),null);
  }
});
test('lights stay off in daylight and fade continuously through twilight', () => {
  for (const sunDot of [1,0.4,0.001,0]) assert.equal(nightOpacity(sunDot),0);
  assert.equal(nightOpacity(-0.13),0.5); assert.equal(nightOpacity(-0.26),1); assert.equal(nightOpacity(-1),1);
  let previous=0;
  for(let i=1;i<=260;i++){const a=nightOpacity(-i/1000);assert.ok(a>=previous);assert.ok(a-previous<0.006);previous=a;}
});
test('equirectangular coordinates wrap at the dateline and keep north at the top', () => {
  assert.deepEqual(nightUV(0,0),[0.5,0.5]);
  assert.deepEqual(nightUV(-180,90),[0,0]); assert.deepEqual(nightUV(180,-90),[0,1]);
  assert.deepEqual(nightUV(540,0),nightUV(-180,0));
  assert.ok(nightUV(-74,40.7)[0]<0.5); assert.ok(nightUV(139.7,35.7)[0]>0.5);
});
test('globe darkness preserves daylight and fades continuously to six percent terrain brightness', () => {
  assert.equal(globeNightShade(1),0);
  assert.equal(globeNightShade(0.26),0);
  assert.equal(globeNightShade(0),0.47);
  assert.equal(globeNightShade(-0.26),0.94);
  assert.equal(globeNightShade(-1),0.94);
  let previous=0;
  for (let i=260;i>=-260;i--) {
    const shade=globeNightShade(i/1000);
    assert.ok(shade>=previous); assert.ok(shade-previous<0.003); previous=shade;
  }
});
test('lights match the map device pixels while retaining a bounded large-screen framebuffer', () => {
  assert.equal(nightRenderScale(1280,720,2),2);
  assert.equal(nightRenderScale(390,844,3),2);
  assert.equal(nightRenderScale(3840,2160,1),1);
  const scale=nightRenderScale(6000,4000,3);
  assert.ok(6000*4000*scale*scale<=8388608+1);
  assert.ok(6000*scale<=4096);
});
test('close zoom covers the visible night area with a bounded satellite tile pyramid in both projections', async () => {
  const projection=geoNaturalEarth1().fitExtent([[20,20],[1980,980]],{type:'Sphere'});
  for (const center of [[-0.45,51.47],[139.7,35.7],[179,40],[-179,-40],[0,88],[0,-88]]) {
    const g={...frame(...center),cx:640,cy:360,R:5000};
    const [u,v]=nightUV(...center);
    for (const mode of ['globe','flat']) {
      const pos=projection(center);
      const o={mode,width:1280,height:720,dpr:2,frame:g,sun:spherePoint(center[0]+180,-center[1]),
        projectionScale:projection.scale(),translate:projection.translate(),view:{k:12,x:640-pos[0]*12,y:360-pos[1]*12}};
      const tiles=visibleNightTiles(o,8192);
      assert.ok(tiles.length,`${mode} at ${center} has a detail level`);
      const level=nightTileInfo(tiles[0]).level,grid=NIGHT_TILE_LEVELS[level];
      const centerTile=`${level}/${Math.floor(u*grid.columns)}-${Math.min(grid.rows-1,Math.floor(v*grid.rows))}`;
      assert.ok(tiles.includes(centerTile),`${mode} at ${center} loads its center tile`);
      assert.ok(tiles.filter(id=>!nightTileInfo(id).empty).length<=36);
      for (const tile of tiles) if (!nightTileInfo(tile).empty) await access(new URL(`../public/textures/night-tiles/${tile}.jpg`,import.meta.url));
      assert.deepEqual(visibleNightTiles({...o,sun:spherePoint(...center)},8192),[],`${mode} at ${center} does not load daytime detail`);
    }
  }
  const o={mode:'globe',width:1280,height:720,dpr:2,frame:frame(0,0),sun:spherePoint(180,0)};
  assert.deepEqual(visibleNightTiles(o,8192),[],'zoomed-out view uses its overview texture');
});
test('deep globe zoom reaches the actual 500 m source and smaller GPUs retain complete coverage', () => {
  const o={mode:'globe',width:1280,height:720,dpr:2,frame:{...frame(-0.45,51.47),cx:805,cy:395,R:4536},sun:spherePoint(180,0)};
  const tiles=visibleNightTiles(o,8192);
  assert.equal(nightTileInfo(tiles[0]).level,2);
  assert.equal(NIGHT_TILE_LEVELS[2].columns*NIGHT_TILE_SIZE,86400);
  const small=visibleNightTiles(o,8192,9);
  assert.ok(small.length);
  assert.ok(small.filter(id=>!nightTileInfo(id).empty).length<=9);
  assert.ok(nightTileInfo(small[0]).level<2);
});
test('every nonempty satellite tile in the manifest is bundled locally', async () => {
  const checks=[];
  for (const [level,grid] of NIGHT_TILE_LEVELS.entries()) {
    assert.equal(grid.available.length,grid.columns*grid.rows);
    for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns;col++) {
      const id=`${level}/${col}-${row}`;
      if (!nightTileInfo(id).empty) checks.push(access(new URL(`../public/textures/night-tiles/${id}.jpg`,import.meta.url)));
    }
  }
  await Promise.all(checks);
});
