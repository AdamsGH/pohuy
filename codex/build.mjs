import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('./', import.meta.url));
const result = await build({
  entryPoints: [directory + 'controller.ts', directory + 'server.ts'],
  outdir: directory + 'dist', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22', metafile: true, minify: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
await mkdir(directory + 'dist', { recursive: true });
const packages = [...new Set(Object.keys(result.metafile.inputs).flatMap(input => {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
  return match ? [match[1]] : [];
}))].sort();
const licenses = [];
for (const name of packages) {
  const base = new URL(`../node_modules/${name}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', base), 'utf8'));
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'license', 'license.md']) {
    try { license = await readFile(new URL(filename, base), 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!license && name === '@cfworker/json-schema') license = await readFile(new URL('./licenses/cfworker.txt', import.meta.url), 'utf8');
  if (!license) throw new Error(`Missing license: ${name}`);
  licenses.push(`${name} ${manifest.version}\n${license}`);
}
await writeFile(directory + 'dist/THIRD_PARTY_LICENSES.txt', licenses.join('\n\n'));
