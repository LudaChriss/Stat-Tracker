// Runs every suite in this directory and reports a single pass/fail.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('.', import.meta.url).pathname;
const suites = readdirSync(dir).filter((f) => f.endsWith('check.mjs')).sort();

let failed = 0;
let total = 0;

for (const suite of suites) {
  const run = spawnSync(process.execPath, [dir + suite], { encoding: 'utf8' });
  const out = run.stdout || '';
  const passed = (out.match(/^ok /gm) || []).length;
  const bad = out.split('\n').filter((l) => l.startsWith('FAIL'));
  total += passed;
  if (run.status !== 0 || bad.length) {
    failed += bad.length || 1;
    console.log(`FAIL ${suite}`);
    bad.forEach((l) => console.log('     ' + l));
    // Print enough of stderr to actually diagnose a failure. One line is
    // usually just the file:line, which says nothing about why.
    if (run.stderr) {
      run.stderr
        .split('\n')
        .filter((l) => l.trim())
        .slice(0, 6)
        .forEach((l) => console.log('     ' + l));
    }
  } else {
    console.log(`ok   ${suite.padEnd(20)} ${String(passed).padStart(3)} assertions`);
  }
}

console.log(failed ? `\n${failed} FAILED` : `\nall passed — ${total} assertions across ${suites.length} suites`);
process.exit(failed ? 1 : 0);
