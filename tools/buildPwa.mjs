import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const root = new URL('../dist/', import.meta.url);
const template = await readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8');
async function assets(directory = 'assets') {
  const entries = await readdir(new URL(directory + '/', root), { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => entry.isDirectory()
    ? assets(`${directory}/${entry.name}`) : [`/${directory}/${entry.name}`]));
  return groups.flat();
}
// Deliberately exclude the 620 MiB tile library. Cache detail only when visited.
const urls = [
  '/index.html', '/site.webmanifest', '/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png',
  '/apple-touch-icon.png', '/icons/airport-manager-192.png', '/icons/airport-manager-512.png',
  '/textures/earth-day-mobile.jpg', '/textures/earth-night-mobile.jpg', ...await assets(),
].sort();
const hash = createHash('sha256').update(template);
let bytes = 0;
for (const url of urls) {
  const data = await readFile(new URL(url.slice(1), root));
  hash.update(url).update(data); bytes += data.length;
}
const version = hash.digest('hex').slice(0, 16);
await writeFile(new URL('sw.js', root), template
  .replace('__PWA_VERSION__', JSON.stringify(version))
  .replace('__PWA_SHELL__', JSON.stringify(urls)));
console.log(`PWA ${version}: ${urls.length} offline files, ${(bytes / 1024 / 1024).toFixed(1)} MiB. Detail imagery is cached on demand.`);
