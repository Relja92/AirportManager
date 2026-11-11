import layout from './data/nightTiles.js';
import {createSatelliteTileAtlas, satelliteTileInfo} from './satelliteTileAtlas.js';

export const NIGHT_TILE_SIZE = layout.tileSize;
export const NIGHT_TILE_STRIDE = layout.tileSize + 2 * layout.gutter;
export const NIGHT_TILE_LEVELS = layout.levels;
export const nightTileInfo = (id) => satelliteTileInfo(layout, id);
export const createNightTileAtlas = (gl) => createSatelliteTileAtlas(gl, {layout, path:'/textures/night-tiles'});
