const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar');
const { extractTemplate } = require('@capacitor/cli/dist/util/template');

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
