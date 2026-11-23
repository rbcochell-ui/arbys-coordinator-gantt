import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const textExtensions = new Set(['.mjs', '.js', '.html', '.json', '.md']);
const allowedFormKeys = new Set([
  'F:12345:67890', 'F:123:456', 'F:123:457', 'F:123:999',
]);
const allowedNativeIds = new Set([
  '0WO123456789012345', '0WOaaaaaaaaaaaaAAA',
]);

async function files(dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() &&
        !['node_modules', 'dist', '.git'].includes(entry.name)) {
      found.push(...await files(path));
    } else if (entry.isFile() &&
        [...textExtensions].some(extension => path.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

test('public customer package has no real identity or capability literal', async () => {
  let count = 0;
  for (const path of await files(root)) {
    const text = await readFile(path, 'utf8');
    count += 1;
    const formKeys = text.match(/F:[0-9]{1,20}:[0-9]{1,20}/gu) ?? [];
    const nativeIds = text.match(/0WO[A-Za-z0-9]{15}/gu) ?? [];
    const emails = text.match(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu) ?? [];
    assert.ok(formKeys.every(value => allowedFormKeys.has(value)),
      'A non-synthetic FORM key appeared in ' + path);
    assert.ok(nativeIds.every(value => allowedNativeIds.has(value)),
      'A non-synthetic native WO ID appeared in ' + path);
    assert.ok(emails.every(value => value.endsWith('@example.invalid')),
      'A non-synthetic email appeared in ' + path);
    assert.equal(/#k=[A-Za-z0-9_-]{40,}/u.test(text), false,
      'A literal capability key appeared in ' + path);
    assert.equal(/\?p=p_[A-Za-z0-9_-]{12,}/u.test(text), false,
      'A literal project capability appeared in ' + path);
  }
  assert.ok(count >= 30, 'Package scan unexpectedly small');
});
