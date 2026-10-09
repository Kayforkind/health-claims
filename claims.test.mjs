import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClaim, renderClaim } from './claims.mjs';

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
