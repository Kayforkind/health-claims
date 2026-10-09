import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClaim, renderClaim, staleWarnings, renderReport, reviewAgeDays } from './claims.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'claims.mjs');
const TODAY = new Date('2026-10-09T00:00:00Z');

const src = (over = {}) => ({ kind: 'review', url: 'https://example.org/review', title: 'Example review', retrieved: '2026-10-01', ...over });
const base = (over = {}) => ({ id: 'c1', text: 'Placeholder claim', verdict: 'supported', sources: [src()], reviewer: 'Reviewer A', reviewedOn: '2026-10-02', ...over });

test('a sourced, reviewed claim is valid', () => {
  assert.deepEqual(validateClaim(base()), []);
});

test('a claim with no sources is rejected', () => {
  assert.ok(validateClaim(base({ sources: [] })).some((e) => /at least one source/.test(e)));
});

test('a non-https source is rejected', () => {
  assert.ok(validateClaim(base({ sources: [src({ url: 'http://example.org' })] })).some((e) => /must be https/.test(e)));
});

test('a source without a retrieval date is rejected', () => {
  assert.ok(validateClaim(base({ sources: [src({ retrieved: 'last week' })] })).some((e) => /retrieved date/.test(e)));
});

test('a verdict backed only by marketing or news is rejected', () => {
  const c = base({ sources: [src({ kind: 'marketing' })] });
  assert.ok(validateClaim(c).some((e) => /needs a review, guideline, or primary source/.test(e)));
});

test('not-enough-evidence needs no reviewer or review date', () => {
  const c = { text: 'Unclear claim', verdict: 'not-enough-evidence', sources: [src({ kind: 'news' })] };
  assert.deepEqual(validateClaim(c), []);
});

test('a verdict without a reviewer is rejected', () => {
  assert.ok(validateClaim(base({ reviewer: undefined })).some((e) => /reviewer name/.test(e)));
});

test('rendering escapes claim text', () => {
  const html = renderClaim(base({ text: '<script>x</script>' }));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a review older than a year gets a warning, a recent one does not', () => {
  assert.equal(reviewAgeDays(base({ reviewedOn: '2026-10-02' }), TODAY), 7);
  assert.equal(staleWarnings(base({ reviewedOn: '2026-10-02' }), TODAY).length, 0);
  const old = staleWarnings(base({ reviewedOn: '2024-01-01' }), TODAY);
  assert.equal(old.length, 1);
  assert.match(old[0], /days old \(limit 365\)/);
});

test('not-enough-evidence never goes stale, and a missing review date is not a stale warning', () => {
  assert.deepEqual(staleWarnings({ text: 't', verdict: 'not-enough-evidence', sources: [src({ kind: 'news' })] }, TODAY), []);
  assert.equal(reviewAgeDays(base({ reviewedOn: undefined }), TODAY), null);
});

test('the report renders valid claims and never renders a held-back claim', () => {
  const good = base({ text: 'Visible claim' });
  const bad = base({ id: 'bad', text: 'SECRET-HELD-TEXT', sources: [] });
  const html = renderReport([
    { id: 'c1', claim: good, errors: [] },
    { id: 'bad', claim: bad, errors: validateClaim(bad) },
  ]);
  assert.ok(html.includes('Visible claim'));
  assert.ok(!html.includes('SECRET-HELD-TEXT'));
  assert.ok(html.includes('Held back'));
  assert.ok(html.includes('at least one source is required'));
});

test('CLI: the bundled example checks clean and writes an HTML report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claims-'));
  const html = join(dir, 'report.html');
  const r = spawnSync(process.execPath, [CLI, 'check', join(here, 'claims.example.json'), '--html', html], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 published, 0 held back/);
  assert.ok(readFileSync(html, 'utf8').includes('PLACEHOLDER'));
});

test('CLI: an unsourced claim is held back, the check exits 1, and its text is not published', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claims-'));
  const file = join(dir, 'claims.json');
  const html = join(dir, 'report.html');
  writeFileSync(file, JSON.stringify([base({ id: 'x', text: 'UNSOURCED-CLAIM', sources: [] })]));
  const r = spawnSync(process.execPath, [CLI, 'check', file, '--html', html], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /HELD\s+x/);
  assert.ok(!readFileSync(html, 'utf8').includes('UNSOURCED-CLAIM'));
});

test('CLI: bad input exits 2 and --fail-on-warn turns stale reviews into failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claims-'));
  const file = join(dir, 'claims.json');
  writeFileSync(file, '{"not":"an array"}');
  assert.equal(spawnSync(process.execPath, [CLI, 'check', file], { encoding: 'utf8' }).status, 2);
  writeFileSync(file, JSON.stringify([base({ reviewedOn: '2020-01-01' })]));
  assert.equal(spawnSync(process.execPath, [CLI, 'check', file], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [CLI, 'check', file, '--fail-on-warn'], { encoding: 'utf8' }).status, 1);
});
