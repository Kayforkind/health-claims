/**
 * Sourced claims model. NOT medical advice, and not a real assessment.
 *
 * Rules enforced by validateClaim():
 *  - every claim has text, a verdict, and at least one source
 *  - every source has an https URL, a title, and a retrieval date (YYYY-MM-DD)
 *  - a verdict other than "not-enough-evidence" requires a source of kind
 *    "review" (systematic review), "guideline", or "primary"
 *  - a claim with a verdict must include a reviewer name and a review date
 *
 * The sample in claims.example.json is a placeholder that shows the shape.
 * It is not an assessment of any real product or claim.
 */

export const VERDICTS = ['supported', 'mixed', 'unsupported', 'not-enough-evidence'];
export const SOURCE_KINDS = ['review', 'guideline', 'primary', 'news', 'marketing'];
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

export function validateAll(claims) {
  return claims.map((c) => ({ id: c.id ?? c.text?.slice(0, 40), errors: validateClaim(c) }));
}

export function renderClaim(c) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const sources = c.sources.map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.title)}</a> (${esc(s.kind)}, retrieved ${esc(s.retrieved)})</li>`).join('');
  return `<article><h3>${esc(c.text)}</h3><p><strong>Verdict:</strong> ${esc(c.verdict)}</p><ul>${sources}</ul><p><small>Reviewed by ${esc(c.reviewer)} on ${esc(c.reviewedOn)}</small></p></article>`;
}
