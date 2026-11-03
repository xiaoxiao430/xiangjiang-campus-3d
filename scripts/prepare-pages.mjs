import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const destination = new URL('docs/', root);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL('dist/', root), destination, { recursive: true });
await writeFile(new URL('.nojekyll', destination), '');
console.log('GitHub Pages files prepared in docs/');
