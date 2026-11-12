// Local and CI wrapper for the shared content policy.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContent } from './content-policy.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const json = process.argv.includes('--json');
const paths = process.argv.slice(2).filter(arg => arg !== '--json').map(path => path.replace(/\\/g, '/').replace(/^\.\//, ''));
const result = validateContent({ root, paths, allowUnresolvedAuthors: !process.env.GITHUB_ACTIONS && !process.env.CI });
if (json) console.log(JSON.stringify(result, null, 2));
else {
  const escape = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const issue of result.issues) {
    console.log(`${issue.severity === 'error' ? 'ERROR' : 'warning'} ${issue.path}:${issue.line} ${issue.message}${issue.fix ? ' ' + issue.fix : ''}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::${issue.severity} file=${escape(issue.path).replace(/,/g, '%2C').replace(/:/g, '%3A')},line=${issue.line}::${escape(issue.message)}`);
  }
  console.log(`Checked ${result.posts.length} entries and ${result.authors.length} authors: ${result.errors.length} errors, ${result.warnings.length} warnings.`);
}
process.exitCode = result.errors.length ? 1 : 0;
