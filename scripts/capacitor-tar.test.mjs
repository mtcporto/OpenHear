import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { extractTemplate } from '@capacitor/cli/dist/util/template.js';

test('Capacitor 5 extracts templates using patched tar 7', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'capacitor-tar-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input');
  const output = path.join(dir, 'output');
  await fs.mkdir(input);
  await fs.writeFile(path.join(input, 'template.txt'), 'template contents');
  const archive = path.join(dir, 'template.tar.gz');
  await tar.create({ gzip: true, cwd: input, file: archive }, ['template.txt']);
  await extractTemplate(archive, output);
  assert.equal(await fs.readFile(path.join(output, 'template.txt'), 'utf8'), 'template contents');
});
