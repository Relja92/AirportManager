# AirportManager

A browser-based airline and airport management game. Build a route network,
manage aircraft and hubs, compete with rival airlines, and explore a world map
or an Earth globe with satellite terrain and night lights.

## Run locally

Requires Node.js 20.19+ on the Node 20 release line, or Node.js 22.12+.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Game progress is stored in the browser.

## Build and test

```sh
npm test
npm run build
npm run preview
```

The production build is generated in `dist/`.

## Deploy to Vercel

Import this repository as a new Vercel project using the Vite framework preset,
`npm run build` as the build command, and `dist` as the output directory.
Add the desired subdomain under the project's Settings → Domains and follow
Vercel's displayed DNS instructions.

## Satellite imagery

Terrain uses NASA Blue Marble Next Generation, August 2004. Night lights use
NASA Black Marble 2016. These are satellite composites, not live imagery.

The images in `public/textures/` are required game assets. They include local
detail tiles that load only for the visible region as the player zooms in.
The imagery library is approximately 620 MiB; players do not download the
whole library at startup. Moving these assets to external storage requires
updating the image loader and deployment configuration first.

Source credits, processing details, and original download links:

- [Terrain](public/textures/terrain-source.txt)
- [Night lights](public/textures/night-lights-source.txt)

The scripts in `tools/` can regenerate the tiles with Python and Pillow from
the documented NASA source images. Original downloads are not part of this
repository. The generated tiles are included so a checkout can run and build
without downloading or processing the original datasets.

## Development files

Automated tests and repeatable playtest generators are included in `tests/`.
Generated reports, screenshots, local settings, environment files, dependencies,
and build output are excluded from Git.
