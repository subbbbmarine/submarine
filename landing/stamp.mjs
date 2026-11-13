// Puts the hash of public/assets/site.js into the page's script address, so a browser holding an older copy of the script
// fetches the new one the moment the page changes. Run before every deploy: node landing/stamp.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = join(dirname(fileURLToPath(import.meta.url)), 'public');
const hash = createHash('sha1').update(readFileSync(join(pub, 'assets', 'site.js'))).digest('hex').slice(0, 10);
const page = join(pub, 'index.html');
const html = readFileSync(page, 'utf8');
const next = html.replace(/assets\/site\.js(\?v=[0-9a-f]+)?"/, `assets/site.js?v=${hash}"`);
if (next === html && !html.includes(`site.js?v=${hash}"`)) throw new Error('No script address found in index.html');
writeFileSync(page, next);
console.log(`site.js?v=${hash}`);
