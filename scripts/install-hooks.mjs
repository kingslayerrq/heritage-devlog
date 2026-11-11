// Runs after `npm install` (the "prepare" script): points git at the hooks kept in .githooks/,
// so everyone who installs the project gets the pre-push check without doing anything.
// Does nothing where there is no git checkout (a downloaded zip) or on GitHub's build machines.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!process.env.CI && existsSync(new URL('../.git', import.meta.url))) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
    console.log('Entry check enabled: it now runs before every git push.');
  } catch { console.warn('Could not enable the pre-push entry check (is git installed?). Run "npm run validate" by hand before pushing.'); }
}
