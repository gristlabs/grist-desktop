// PROBE ONLY - not for merge.
// core logs through a winston transport whose stream is process.stderr. On
// windows that goes nowhere we can read, because electron is a GUI-subsystem
// binary with no attached console. Teach it to honor GRIST_LOG_FILE.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'core', 'app', 'server', 'lib', 'log.ts');
let src = fs.readFileSync(target, 'utf8');

const importAnchor = 'import * as winston from "winston";';
const streamNeedle = '  stream: process.stderr,';
for (const needle of [importAnchor, streamNeedle]) {
  if (!src.includes(needle)) {
    console.error(`patch point not found in log.ts: ${needle}`);
    process.exit(1);
  }
}

src = src.replace(importAnchor, `${importAnchor}\nimport * as probeFs from "fs";`);
src = src.replace(streamNeedle,
  '  stream: process.env.GRIST_LOG_FILE\n' +
  "    ? probeFs.createWriteStream(process.env.GRIST_LOG_FILE, {flags: 'a'})\n" +
  '    : process.stderr,');

fs.writeFileSync(target, src);
console.log('patched log.ts to honor GRIST_LOG_FILE');
