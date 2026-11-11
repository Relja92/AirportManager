// Bounded satellite texture cache. Only visible tiles enter GPU memory.
export function satelliteTileInfo(layout, id) {
  const [level, xy] = id.split('/'), [col, row] = xy.split('-').map(Number);
  const grid = layout.levels[+level];
  return {id, level:+level, col, row, empty:!!grid.available && grid.available[row*grid.columns+col] !== '1'};
}

export function createSatelliteTileAtlas(gl, {layout, path, format = gl.LUMINANCE, maxAcross = 6}) {
  const stride = layout.tileSize + 2 * layout.gutter;
  const across = Math.min(maxAcross, Math.floor(gl.getParameter(gl.MAX_TEXTURE_SIZE) / stride));
  if (!across) return null;
  const capacity = across * across, size = across * stride;
  const atlas = gl.createTexture(), index = gl.createTexture();
  const {columns:indexWidth, rows:indexHeight} = layout.levels.at(-1);
  const pixels = new Uint8Array(indexWidth * indexHeight * 4);
  function setup(texture, width, height, format, filter, data) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  }
  gl.activeTexture(gl.TEXTURE1);
  setup(atlas, size, size, format, gl.LINEAR, null);
  gl.activeTexture(gl.TEXTURE2);
  setup(index, indexWidth, indexHeight, gl.RGBA, gl.NEAREST, pixels);
  if (gl.getError() !== gl.NO_ERROR) {gl.deleteTexture(atlas);gl.deleteTexture(index);return null;}

  const entries = new Map(), failed = new Set();
  let wanted = [], wantedSet = new Set(), revision = 0, disposed = false;
  function cancel(entry) {
    if (entry.image) {entry.image.onload=null;entry.image.onerror=null;entry.image.src='';entry.image=null;}
  }
  function reserveSlot() {
    const used = new Set([...entries.values()].filter(e=>e.slot !== undefined).map(e=>e.slot));
    for (let slot=0;slot<capacity;slot++) if (!used.has(slot)) return slot;
    const oldest = [...entries.values()].filter(e=>e.slot !== undefined && !wantedSet.has(e.id)).sort((a,b)=>a.used-b.used)[0];
    if (!oldest) return null;
    entries.delete(oldest.id);
    return oldest.slot;
  }
  function pump() {
    if (disposed || gl.isContextLost()) return;
    let active = [...entries.values()].filter(e=>e.image).length;
    for (const info of wanted) {
      if (active >= 4) break;
      if (info.empty || entries.has(info.id) || failed.has(info.id)) continue;
      const entry = {...info, image:new Image(), used:performance.now()};
      entries.set(info.id, entry); active++;
      entry.image.onload = () => {
        if (disposed || entries.get(entry.id) !== entry || gl.isContextLost()) return;
        const slot = reserveSlot();
        if (slot === null) {entry.image=null;entries.delete(entry.id);return;}
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, (slot%across)*stride, Math.floor(slot/across)*stride, format, gl.UNSIGNED_BYTE, entry.image);
        entry.image=null;
        if (gl.getError() !== gl.NO_ERROR) {failed.add(entry.id);entries.delete(entry.id);}
        else {entry.slot=slot;entry.loadedAt=performance.now();}
        revision++; pump();
      };
      entry.image.onerror = () => {failed.add(entry.id);entry.image=null;entries.delete(entry.id);revision++;pump();};
      entry.image.src = `${path}/${entry.id}.jpg`;
    }
  }
  return {
    capacity, size,
    get revision(){return revision;},
    get animating(){return wanted.some(info=>{const e=entries.get(info.id);return e?.loadedAt && performance.now()-e.loadedAt<300;});},
    prepare(ids) {
      wanted = ids.map(id => satelliteTileInfo(layout, id)); wantedSet = new Set(ids);
      for (const [id, entry] of entries) {
        if (wantedSet.has(id)) entry.used=performance.now();
        else if (entry.image) {cancel(entry);entries.delete(id);}
      }
      pump();
    },
    bind() {
      pixels.fill(0);
      for (const info of wanted) {
        const p=(info.row*indexWidth+info.col)*4, entry=entries.get(info.id);
        if (info.empty) {pixels[p]=255;pixels[p+2]=255;pixels[p+3]=255;}
        else if (entry?.slot !== undefined) {
          pixels[p]=entry.slot%across;pixels[p+1]=Math.floor(entry.slot/across);
          pixels[p+2]=Math.min(255,Math.round((performance.now()-entry.loadedAt)/300*255));pixels[p+3]=255;
        }
      }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,atlas);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,index);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,indexWidth,indexHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return wanted.length ? layout.levels[wanted[0].level] : {columns:1,rows:1};
    },
    dispose() {
      disposed=true; for (const entry of entries.values()) cancel(entry);
      entries.clear();gl.deleteTexture(atlas);gl.deleteTexture(index);
    },
  };
}
