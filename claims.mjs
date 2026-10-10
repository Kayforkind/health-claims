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
import { readFileSync, writeFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';

export const VERDICTS = ['supported', 'mixed', 'unsupported', 'not-enough-evidence'];
export const SOURCE_KINDS = ['review', 'guideline', 'primary', 'news', 'marketing'];
export const REVIEW_MAX_AGE_DAYS = 365;
const STRONG_KINDS = ['review', 'guideline', 'primary'];

const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const pastDate = (v) => validDate(v) && v <= new Date().toISOString().slice(0, 10);
const sourceUrl = (v) => { try { const u = new URL(v); return typeof v === 'string' && u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };

export function validateClaim(c) {
  const errors = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['claim must be an object'];
  if (!nonempty(c.text)) errors.push('missing claim text');
  if (!VERDICTS.includes(c.verdict)) errors.push(`verdict must be one of ${VERDICTS.join(', ')}`);
  if (!Array.isArray(c.sources) || c.sources.length === 0) {
    errors.push('at least one source is required');
  } else {
    for (const s of c.sources) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push('source must be an object'); continue; }
      if (!SOURCE_KINDS.includes(s.kind)) errors.push(`source kind must be one of ${SOURCE_KINDS.join(', ')}`);
      if (!sourceUrl(s.url)) errors.push('source URL must be https without embedded credentials');
      if (!nonempty(s.title)) errors.push('source missing title');
      if (!pastDate(s.retrieved)) errors.push('source needs a real, non-future retrieved date YYYY-MM-DD');
    }
    const strong = c.sources.some((s) => STRONG_KINDS.includes(s?.kind));
    if (VERDICTS.includes(c.verdict) && c.verdict !== 'not-enough-evidence' && !strong) {
      errors.push('a verdict other than not-enough-evidence needs a review, guideline, or primary source');
    }
  }
  if (c.verdict !== 'not-enough-evidence') {
    if (!nonempty(c.reviewer)) errors.push('reviewer name is required for a verdict');
    if (!pastDate(c.reviewedOn)) errors.push('real, non-future reviewedOn date (YYYY-MM-DD) is required for a verdict');
  }
  return errors;
}

/** Whole days from reviewedOn to `today`, or null when the date is missing or invalid. */
export function reviewAgeDays(claim, today = new Date()) {
  if (!validDate(claim?.reviewedOn)) return null;
  const reviewed = Date.parse(`${claim.reviewedOn}T00:00:00Z`);
  if (Number.isNaN(reviewed)) return null;
  return Math.floor((today.getTime() - reviewed) / 86400000);
}

/** Warnings about a claim that are not validation errors. */
export function staleWarnings(claim, today = new Date(), maxAgeDays = REVIEW_MAX_AGE_DAYS) {
  if (!claim || claim.verdict === 'not-enough-evidence') return [];
  const age = reviewAgeDays(claim, today);
  return age !== null && age > maxAgeDays
    ? [`review is ${age} days old (limit ${maxAgeDays}); re-review before publishing`]
    : [];
}

export function validateAll(claims) {
  return claims.map((c, index) => ({ id: `claim-${index + 1}`, errors: validateClaim(c) }));
}

const REPORT_STYLE = `html{color-scheme:light;background:#f5f7fb;color:#162033;font:16px/1.6 system-ui,sans-serif}body{margin:0;padding:24px}main{max-width:880px;margin:auto}article,section{background:#fff;border:1px solid #d9e1ee;border-radius:12px;padding:20px;margin:20px 0}h1{font-size:2rem}h3{font-size:1.15rem}a{color:#1747a8;overflow-wrap:anywhere}small{color:#46546c}p[role=note]{border-left:4px solid #a05a00;padding:12px;background:#fff6e7}*{box-sizing:border-box}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function renderClaim(c) {
  if (validateClaim(c).length) throw new Error('refusing to render an invalid claim');
  const sources = c.sources.map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.title)}</a> (${esc(s.kind)}, retrieved ${esc(s.retrieved)})</li>`).join('');
  return `<article><h3>${esc(c.text)}</h3><p><strong>Verdict:</strong> ${esc(c.verdict)}</p><ul>${sources}</ul><p><small>${c.verdict === 'not-enough-evidence' ? 'No assessed verdict; insufficient evidence.' : `Reviewed by ${esc(c.reviewer)} on ${esc(c.reviewedOn)}`}</small></p></article>`;
}

/** Full HTML page: valid claims rendered, invalid claims listed by id and reason only. */
export function renderReport(results, { today = new Date(), maxAgeDays = REVIEW_MAX_AGE_DAYS } = {}) {
  const checked = results.map((r, index) => ({ ...r, id: `claim-${index + 1}`, errors: [...new Set([...validateClaim(r.claim), ...(r.errors ?? [])])] }));
  const published = checked.filter((r) => r.errors.length === 0);
  const unpublished = checked.filter((r) => r.errors.length > 0);
  const body = published.map((r) => renderClaim(r.claim) + (staleWarnings(r.claim, today, maxAgeDays).length ? `<p role="note"><strong>Review warning:</strong> ${staleWarnings(r.claim, today, maxAgeDays).map(esc).join('; ')}</p>` : '')).join('\n');
  const held = unpublished
    .map((r) => `<li><strong>${esc(r.id)}</strong>: ${validateClaim(r.claim).map(esc).join('; ') || 'held by validation policy'}</li>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${createHash('sha256').update(REPORT_STYLE).digest('base64')}'; base-uri 'none'; form-action 'none'"><style>${REPORT_STYLE}</style><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sourced claims report</title></head>
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
  if (values.help || positionals[0] !== 'check' || !positionals[1] || positionals.length !== 2) {
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
    if (!statSync(positionals[1]).isFile() || statSync(positionals[1]).size > 2 * 1024 * 1024) throw new Error('input must be a regular file under 2 MiB');
    claims = JSON.parse(readFileSync(positionals[1], 'utf8'));
    if (!Array.isArray(claims)) throw new Error('claims file must be a JSON array');
  } catch (e) {
    console.error(`bad claims file: ${e.message}`);
    return setExit(2);
  }
  if (values.html && existsSync(values.html)) throw new Error('report output already exists; choose a new filename');
  const today = new Date();
  if (values.html && (existsSync(values.html) ? realpathSync(values.html) : resolve(values.html)) === realpathSync(positionals[1])) throw new Error('report cannot overwrite claims input');
  const results = claims.map((claim, index) => ({
    id: typeof claim?.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(claim.id) ? claim.id : `claim-${index + 1}`,
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
  if (values.html) writeFileSync(values.html, renderReport(results, { today, maxAgeDays: maxAge }), { flag: 'wx', mode: 0o600 });
  const anyError = results.some((r) => r.errors.length > 0);
  const anyWarn = results.some((r) => r.warnings.length > 0);
  console.log(`${results.length - results.filter((r) => r.errors.length).length} published, ${results.filter((r) => r.errors.length).length} held back`);
  return setExit(anyError || (values['fail-on-warn'] && anyWarn) ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    setExit(2);
  }
}
