import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url),'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url),'utf8');
const app = await readFile(new URL('../app.js', import.meta.url),'utf8');
for(const p of ['../assets/room.svg','../assets/grain.svg','../assets/favicon.svg']) await access(new URL(p,import.meta.url));
assert.match(html,/id="packScene"/);
assert.match(html,/id="openPack"/);
assert.match(html,/id="probabilityButton"/);
assert.match(html,/id="overlay"/);
for(const pool of ['ai','cloud','software','education']) {
  assert.match(app,new RegExp(`id: '${pool}'`));
  assert.match(css,new RegExp(`pack--${pool}`.replace('pack--ai','pack--cloud|pack--software|pack--education'))); // styling shared for AI
}
assert.match(app,/MAX_DRAWS=3/);
assert.match(app,/chance:0.70/);
assert.match(app,/chance:0.25/);
assert.match(app,/chance:0.05/);
assert.match(css,/prefers-reduced-motion/);
console.log('PASS: DOM hooks, four pools, assets, probabilities, reduced-motion styles');
