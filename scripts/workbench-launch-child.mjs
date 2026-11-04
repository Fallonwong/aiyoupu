#!/usr/bin/env node
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {main} from './workbench-server.mjs';

const argsFile = process.argv[2];
const a = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
const argv = ['--preview', a.preview, '--port', String(a.port ?? 7801), ...(a.readyFile ? ['--ready-file', a.readyFile] : [])];
main(argv).catch(error => {
  const record = {status: 'blocked', code: error?.code ?? 'WORKBENCH_START_FAILED', message: error?.message ?? String(error), next: error?.next ?? 'Inspect the launch record and retry.'};
  fs.writeFileSync(a.errorFile ?? path.join(path.dirname(argsFile), 'launch-error.json'), JSON.stringify(record, null, 2) + '\n');
});
