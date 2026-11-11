// Builds the site's docs pages as plain files into landing/public, beside the landing page, for submarine.live/docs.
// The pages are the terminal's own (web/src/app/docs), put in a small app of their own with landing/docs-site's layout, so
// they keep one source. Run: node "D:\10 проектов\launchpad-lrzr\landing\build-docs.mjs", then deploy as in README.md.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const landing = dirname(fileURLToPath(import.meta.url));
const web = join(landing, '..', 'web');
const app = join(web, '.docs-site'); // inside web, so it finds web's packages
const pub = join(landing, 'public');

rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, 'src', 'app'), { recursive: true });
mkdirSync(join(app, 'src', 'lib'), { recursive: true });
cpSync(join(web, 'src', 'app', 'docs'), join(app, 'src', 'app', 'docs'), { recursive: true });
for (const f of ['globals.css', 'icon.svg']) cpSync(join(web, 'src', 'app', f), join(app, 'src', 'app', f));
for (const f of ['config.ts', 'api.ts', 'submarine.ts']) cpSync(join(web, 'src', 'lib', f), join(app, 'src', 'lib', f));
for (const f of ['tailwind.config.ts', 'postcss.config.mjs', 'tsconfig.json']) cpSync(join(web, f), join(app, f));
cpSync(join(landing, 'docs-site', 'layout.tsx'), join(app, 'src', 'app', 'layout.tsx'));
cpSync(join(landing, 'docs-site', 'next.config.mjs'), join(app, 'next.config.mjs'));

const next = createRequire(join(web, 'package.json')).resolve('next/dist/bin/next');
execFileSync(process.execPath, [next, 'build'], {
  cwd: app,
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_DOCS_ONLY: '1', NEXT_PUBLIC_CHAIN_ID: '1337', NEXT_PUBLIC_API_URL: 'https://submarine.live', NEXT_TELEMETRY_DISABLED: '1' },
});

// What the last build left in public goes first, so a page taken out of the docs doesn't stay online.
const out = join(app, 'out');
for (const name of readdirSync(pub)) if (name === '_next' || name === 'docs' || /^docs\.|^icon\.svg|^__next/.test(name)) rmSync(join(pub, name), { recursive: true, force: true });
for (const name of readdirSync(out)) {
  if (name === 'index.html' || name === 'index.txt' || name === '404.html' || name.startsWith('_not-found') || name === '404') continue;
  cpSync(join(out, name), join(pub, name), { recursive: true });
}
if (!existsSync(join(pub, 'docs.html'))) throw new Error('The build made no docs.html');
console.log('docs written to', pub);
