import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

test('vendored source and local binding patches match pinned SHA-256 digests', () => {
  const vendor = new URL('../vendor/', import.meta.url);
  const pin = JSON.parse(readFileSync(new URL('VENDOR_PIN.json', vendor),
    'utf8'));
  assert.equal(pin.algorithm, 'sha256');
  const names = readdirSync(new URL('lean_v3/', vendor))
    .map(name => `lean_v3/${name}`).concat('snapshot_parent_adapter.mjs')
    .sort();
  assert.deepEqual(names, Object.keys(pin.files).sort());
  for (const name of names) {
    assert.match(name, /^(?:lean_v3\/)?[a-z0-9_]+\.mjs$/u);
    const hash = createHash('sha256')
      .update(readFileSync(new URL(name, vendor))).digest('hex');
    assert.equal(hash, pin.files[name], name);
  }
});
