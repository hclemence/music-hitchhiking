import { readFileSync, writeFileSync } from 'node:fs';
import { buildSampleMap } from './sample-map.ts';

const songs = JSON.parse(
  readFileSync(new URL('../data/sample-songs.json', import.meta.url), 'utf8'),
);
const map = buildSampleMap(songs, 'sample-v1');
writeFileSync(
  new URL('../data/sample-map.json', import.meta.url),
  JSON.stringify(map, null, 2) + '\n',
);
console.log(`${map.regions.length} regions, ${map.songs.length} songs, ${map.docks.length} docks`);
