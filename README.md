# sourced-claims

**A validator that refuses a verdict unless it cites a strong source and names a reviewer.**

This is the data model and validation layer for a claim-checking page. Each claim has text, a verdict, and sources. `validateClaim()` returns the list of problems. An empty list means the record meets the rules. It does not decide whether a claim is true.

## Status: template, not medical content

- The sample in `claims.example.json` is **placeholder data**. It makes no health claim and gives no verdict about any product, treatment or person.
- The code only enforces that the paperwork is present. A qualified human reviewer and primary sources decide what is true.
- Do not publish verdicts about health, medicine or safety based on this tool alone. Check the rules that apply to medical and advertising claims where you publish.

## Usage

```js
import { validateClaim } from './claims.mjs';

const problems = validateClaim({
  text: 'Placeholder claim text to be replaced by a reviewed statement',
  verdict: 'supported',                       // supported | mixed | unsupported | not-enough-evidence
  sources: [{
    kind: 'review',                            // review | guideline | primary | news | marketing
    url: 'https://example.org/review',         // must be https
    title: 'Systematic review',
    retrieved: '2026-01-15',                   // YYYY-MM-DD
  }],
  reviewer: 'Name of qualified reviewer',
  reviewedOn: '2026-01-20',                    // YYYY-MM-DD
});
console.log(problems); // [] when valid
```

## Check a file and build a report

```bash
node claims.mjs check claims.example.json --html report.html
node claims.mjs check claims.json --max-review-age-days 180 --fail-on-warn
```

```
OK    PLACEHOLDER: replace with a reviewed cla
1 published, 0 held back
```

- Each claim prints as `OK`, `WARN`, or `HELD`. A `HELD` claim has at least one error.
- `--html` writes a standalone page. **Only claims with no errors are rendered.** A held-back claim appears by id and reason only, so unchecked text cannot reach the page.
- A verdict whose review is older than `--max-review-age-days` (default 365) gets a warning. Warnings fail the check only with `--fail-on-warn`.
- Exit `0` clean, `1` a held-back claim (or a warning with `--fail-on-warn`), `2` bad input.

## Rules

- `text` is required.
- `verdict` must be one of `supported`, `mixed`, `unsupported`, `not-enough-evidence`.
- At least one source is required. Every source needs a `kind` from the allowed list, an `https://` URL, a `title`, and a `retrieved` date.
- Any verdict other than `not-enough-evidence` needs at least one **strong** source: `review`, `guideline`, or `primary`. News and marketing sources alone are not enough.
- Any verdict other than `not-enough-evidence` also needs a `reviewer` and a `reviewedOn` date.
- `renderClaim()` escapes all text and renders a claim with its sources and reviewer line.

## Development

```bash
npm test
```

## License

MIT
