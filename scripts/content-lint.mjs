// Dependency-free source lint: JS syntax, conflict markers, and trailing whitespace.
// Astro's production build separately validates .astro and TypeScript compilation.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
let failed = false, checked = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.astro', 'dist'].includes(entry.name) || entry.isSymbolicLink()) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!/\.(?:[cm]?js|ts|astro|json|ya?ml)$/.test(entry.name)) continue;
    checked++;
    const source = readFileSync(file, 'utf8');
    source.split(/\r?\n/).forEach((line, index) => {
      if (/^(?:<{7}|>{7}|={7})(?: |$)/.test(line) || /[ \t]+$/.test(line)) {
        console.error(`${relative(root, file)}:${index + 1}: conflict marker or trailing whitespace`); failed = true;
      }
    });
    if (/\.[cm]?js$/.test(entry.name)) {
      const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (check.status !== 0) { console.error(check.stderr); failed = true; }
    }
  }
}
walk(root);
console.log(`Linted ${checked} source/config files.`);
process.exitCode = failed ? 1 : 0;
