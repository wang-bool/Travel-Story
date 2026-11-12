// Run each test file directly so Node's test runner executes and reports every nested test.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const files = (await readdir(new URL('../tests/', import.meta.url))).filter(name => name.endsWith('.test.mjs')).sort();
let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../tests/${file}`, import.meta.url))], { stdio: 'inherit', env: process.env });
    if (result.status !== 0)
        failed = true;
}
process.exitCode = failed ? 1 : 0;
