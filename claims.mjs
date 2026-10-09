#!/usr/bin/env node
/**
 * Sourced health-claims model (template). NOT medical advice, and not a real assessment.
 *
 * Rules enforced by validateClaim():
 *  - every claim has text, a verdict, and at least one source
 *  - every source has an https URL, a title, and a retrieval date (YYYY-MM-DD)
 *  - a verdict other than "not-enough-evidence" requires a source of kind
 *    "review" (systematic review), "guideline", or "primary"
 *  - a claim with a verdict must include a reviewer name and a review date
 *
 * Warnings (do not fail the check unless --fail-on-warn):
 *  - a verdict whose review is older than REVIEW_MAX_AGE_DAYS
 *
 * Publishing safety: `check` renders only claims with no errors. A claim that
 * fails validation is listed as unpublished and its text never reaches the report.
 *
 * The sample in claims.example.json is a placeholder that shows the shape.
 * It is not an assessment of any real product or claim.
 *
 * Usage:
 *   node claims.mjs check claims.json [--html report.html] [--max-review-age-days 365] [--fail-on-warn]
 * Exit: 0 all claims valid · 1 any claim invalid (or a warning with --fail-on-warn) · 2 bad input
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export const VERDICTS = ['supported', 'mixed', 'unsupported', 'not-enough-evidence'];
export const SOURCE_KINDS = ['review', 'guideline', 'primary', 'news', 'marketing'];
export const REVIEW_MAX_AGE_DAYS = 365;
const STRONG_KINDS = ['review', 'guideline', 'primary'];

export function validateClaim(c) {
  const errors = [];
  if (!c.text || typeof c.text !== 'string') errors.push('missing claim text');
  if (!VERDICTS.includes(c.verdict)) errors.push(`verdict must be one of ${VERDICTS.join(', ')}`);
  if (!Array.isArray(c.sources) || c.sources.length === 0) {
    errors.push('at least one source is required');
  } else {
    for (const s of c.sources) {
      if (!SOURCE_KINDS.includes(s.kind)) errors.push(`source kind must be one of ${SOURCE_KINDS.join(', ')}`);
      if (!/^https:\/\//.test(s.url ?? '')) errors.push(`source URL must be https: ${s.url}`);
      if (!s.title) errors.push(`source missing title: ${s.url}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.retrieved ?? '')) errors.push(`source needs retrieved date YYYY-MM-DD: ${s.url}`);
    }
    const strong = c.sources.some((s) => STRONG_KINDS.includes(s.kind));
    if (VERDICTS.includes(c.verdict) && c.verdict !== 'not-enough-evidence' && !strong) {
      errors.push('a verdict other than not-enough-evidence needs a review, guideline, or primary source');
    }
  }
  if (c.verdict !== 'not-enough-evidence') {
    if (!c.reviewer) errors.push('reviewer name is required for a verdict');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.reviewedOn ?? '')) errors.push('reviewedOn date (YYYY-MM-DD) is required for a verdict');
  }
  return errors;
}

/** Whole days from reviewedOn to `today`, or null when the date is missing or invalid. */
export function reviewAgeDays(claim, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(claim.reviewedOn ?? '')) return null;
  const reviewed = Date.parse(`${claim.reviewedOn}T00:00:00Z`);
  if (Number.isNaN(reviewed)) return null;
  return Math.floor((today.getTime() - reviewed) / 86400000);
}

/** Warnings about a claim that are not validation errors. */
export function staleWarnings(claim, today = new Date(), maxAgeDays = REVIEW_MAX_AGE_DAYS) {
  if (claim.verdict === 'not-enough-evidence') return [];
  const age = reviewAgeDays(claim, today);
  return age !== null && age > maxAgeDays
    ? [`review is ${age} days old (limit ${maxAgeDays}); re-review before publishing`]
    : [];
}

export function validateAll(claims) {
  return claims.map((c) => ({ id: c.id ?? c.text?.slice(0, 40), errors: validateClaim(c) }));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function renderClaim(c) {
  const sources = c.sources.map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.title)}</a> (${esc(s.kind)}, retrieved ${esc(s.retrieved)})</li>`).join('');
  return `<article><h3>${esc(c.text)}</h3><p><strong>Verdict:</strong> ${esc(c.verdict)}</p><ul>${sources}</ul><p><small>Reviewed by ${esc(c.reviewer)} on ${esc(c.reviewedOn)}</small></p></article>`;
}

/** Full HTML page: valid claims rendered, invalid claims listed by id and reason only. */
export function renderReport(results) {
  const published = results.filter((r) => r.errors.length === 0);
  const unpublished = results.filter((r) => r.errors.length > 0);
  const body = published.map((r) => renderClaim(r.claim)).join('\n');
  const held = unpublished
    .map((r) => `<li><strong>${esc(r.id)}</strong>: ${r.errors.map(esc).join('; ')}</li>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sourced claims report</title></head>
<body><main><h1>Sourced claims</h1><p>Template report. Not medical advice.</p>
${body}
${unpublished.length ? `<section><h2>Held back (failed validation)</h2><ul>${held}</ul></section>` : ''}
</main></body></html>
`;
}

function setExit(code) {
  process.exitCode = code;
  return code;
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      html: { type: 'string' },
      'max-review-age-days': { type: 'string', default: String(REVIEW_MAX_AGE_DAYS) },
      'fail-on-warn': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const usage = 'usage: claims.mjs check claims.json [--html report.html] [--max-review-age-days N] [--fail-on-warn]';
  if (values.help || positionals[0] !== 'check' || !positionals[1]) {
    console.log(usage);
    return setExit(values.help ? 0 : 2);
  }
  const maxAge = Number(values['max-review-age-days']);
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    console.error('--max-review-age-days must be a whole number, 0 or more');
    return setExit(2);
  }
  let claims;
  try {
    claims = JSON.parse(readFileSync(positionals[1], 'utf8'));
    if (!Array.isArray(claims)) throw new Error('claims file must be a JSON array');
  } catch (e) {
    console.error(`bad claims file: ${e.message}`);
    return setExit(2);
  }
  const today = new Date();
  const results = claims.map((claim) => ({
    id: claim.id ?? String(claim.text ?? '').slice(0, 40),
    claim,
    errors: validateClaim(claim),
    warnings: staleWarnings(claim, today, maxAge),
  }));
  for (const r of results) {
    const status = r.errors.length ? 'HELD' : r.warnings.length ? 'WARN' : 'OK';
    console.log(`${status.padEnd(5)} ${r.id}`);
    for (const e of r.errors) console.log(`      error: ${e}`);
    for (const w of r.warnings) console.log(`      warn:  ${w}`);
  }
  if (values.html) writeFileSync(values.html, renderReport(results));
  const anyError = results.some((r) => r.errors.length > 0);
  const anyWarn = results.some((r) => r.warnings.length > 0);
  console.log(`${results.length - results.filter((r) => r.errors.length).length} published, ${results.filter((r) => r.errors.length).length} held back`);
  return setExit(anyError || (values['fail-on-warn'] && anyWarn) ? 1 : 0);
}

if (process.argv[1]?.endsWith('claims.mjs')) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    setExit(2);
  }
}
