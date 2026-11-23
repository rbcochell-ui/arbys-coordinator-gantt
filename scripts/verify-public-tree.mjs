import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// GitHub exposes source, tests, and docs as well as the compiled Pages bundle.
// Report only file paths and categories so a failed check does not print data.
const root = fileURLToPath(new URL('../', import.meta.url));
const listed = execFileSync('git',
  ['ls-files', '-co', '--exclude-standard', '-z'],
  {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
const files = [...new Set(listed)].sort();
const fixtureFormKeys = new Set(['F:12345:67890', 'F:12345678:9999999999']);
const fixtureWoIds = new Set(['0WOTN00000abcde4AA']);
const fixtureCaseNumbers = new Set([
  '00123456', '11111111', '12345678', '22222222', '33333333',
  '44444444', '55555555', '66666666', '77777777', '88888888', '99999999',
]);
// This invented alternate Outlet ACN occurs only in the two local provider
// regression files. It must remain a finding anywhere else in the repo.
const fixtureAlternateAcnPaths = new Set([
  'source/gantt_github_snapshot_first_provider_flow_source_only_20261123_v6_recipient_review/tests/one_click_writer.test.mjs',
  'source/gantt_github_snapshot_first_provider_flow_source_only_20261123_v7_verified_prefill/tests/one_click_writer.test.mjs',
]);
const fixtureAlternateAcn = '00' + '999999';
const publicCatalogNumbers = new Set([
  '1234567', // invented test work order number
  '3508899', '3510205', '3514278', '3517264', '3523343', '3524217',
]);
const isCalendarDate = value => {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 2020 || year > 2035 || month < 1 || month > 12) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const checks = [
  {name: 'non-fixture email', pattern: /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,120}\.[A-Z]{2,24}\b/giu,
    allowed: value => value.toLowerCase().endsWith('@example.invalid')},
  {name: 'native work order ID', pattern: /\b0WOTN[A-Z0-9]{12,18}\b/giu,
    allowed: value => fixtureWoIds.has(value)},
  {name: 'FORM case key', pattern: /\bF:[0-9]{5,}:[0-9]{5,}\b/gu,
    allowed: value => fixtureFormKeys.has(value)},
  {name: 'unreviewed seven-digit number', pattern: /\b[0-9]{7}\b/gu,
    allowed: value => publicCatalogNumbers.has(value)},
  {name: 'unreviewed eight-digit number', pattern: /\b[0-9]{8}\b/gu,
    allowed: (value, relative) => fixtureCaseNumbers.has(value) ||
      isCalendarDate(value) ||
      (value === fixtureAlternateAcn && fixtureAlternateAcnPaths.has(relative))},
  {name: 'complete tracker capability', pattern: /(?:#k=|%23k%3d)[A-Z0-9_-]{43}(?![A-Z0-9_-])/giu,
    allowed: () => false},
  {name: 'GitHub credential', pattern: /\b(?:gh[pousr]_[A-Z0-9]{20,}|github_pat_[A-Z0-9_]{30,})\b/giu,
    allowed: () => false},
  {name: 'bearer credential', pattern: /\bBearer\s+[A-Z0-9._~-]{24,}/giu,
    allowed: () => false},
];

const violations = [];
for (const [index, relative] of files.entries()) {
  for (const check of checks) {
    for (const match of relative.matchAll(check.pattern)) {
      if (!check.allowed(match[0], relative)) {
        violations.push([index, 'filename ' + check.name]);
        break;
      }
    }
  }
  const path = join(root, relative);
  if (!existsSync(path)) continue; // Deleted tracked files are absent from the candidate.
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    violations.push([index, 'unreadable file']);
    continue;
  }
  if (bytes.includes(0)) {
    violations.push([index, 'non-text file']);
    continue;
  }
  let contents;
  try {
    contents = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    violations.push([index, 'invalid UTF-8']);
    continue;
  }
  for (const check of checks) {
    for (const match of contents.matchAll(check.pattern)) {
      if (!check.allowed(match[0], relative)) {
        violations.push([index, check.name]);
        break;
      }
    }
  }
}

if (violations.length) {
  for (const [index, kind] of violations) {
    console.error('repository file #' + index + ': ' + kind);
  }
  process.exitCode = 1;
} else {
  console.log('Public tree scan passed: ' + files.length +
    ' repository filenames and contents; no unreviewed email, source ID, tracker key, or credential literal.');
}
