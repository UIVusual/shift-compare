# CLAUDE.md — Shift Compare

Client-side web app that parses a monthly "Shift Table" PDF and shows who works
which shift per day. No build step, no backend, no dependencies to install.

## Files

- `index.html` — entire UI: styles, markup, and app logic in one file (vanilla JS, ES5-style)
- `parser.js` — PDF table parser; UMD module shared by the browser and Node tests
- `shift.pdf` — real schedule with employee names. **Git-ignored. Never commit or publish it.**
- `SPEC.md` — feature spec, PDF layout facts, parsing algorithm. Read it before touching the parser.

## Rules

- **Privacy**: `shift.pdf` (and `*.pdf`) must stay out of git. Repo is public.
- Keep it zero-build: plain HTML/JS/CSS, pdf.js from CDN. No bundlers, no frameworks, no npm in this repo.
- Keep `parser.js` UMD (browser global `ShiftParser` + CommonJS) so Node tests keep working.
- UI is strict black & white / grayscale, macOS-like. No color, ever. Use the existing CSS variables in `:root`.
- All parsing stays client-side; the PDF must never leave the user's browser.

## Run locally

```
python -m http.server 8000
```
Open http://localhost:8000 (pdf.js worker won't load from `file://`). Click
"Load shift.pdf" or drag a PDF in.

## Verify parser changes

There is no test runner in the repo (npm-free). Verify against the real PDF with a
throwaway Node script outside the repo:

```
mkdir %TEMP%\sc-test && cd %TEMP%\sc-test
npm init -y && npm i pdfjs-dist@3.11.174
```

Then load `pdfjs-dist/legacy/build/pdf.js`, extract text items per page as
`{ str, x: transform[4], y: viewportHeight - transform[5], width }`, call
`ShiftParser.parseShiftSchedule(pages)`, and check:

1. Month/year detected (e.g. July 2026)
2. Employee count (~30; "Vacant" rows appear with 0 shifts)
3. **Gold check**: per-day counts of `A` and `B` (regular + OT called-ins) must
   match the PDF's own bottom `Total A` / `Total B` rows for every day.

## Deploy

GitHub Pages serves `main` branch root at https://uivusual.github.io/shift-compare/
(repo `UIVusual/shift-compare`). Deploy = commit + push; Pages rebuilds in ~1 min.

```
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## Syntax check without a browser

Extract the inline `<script>` block from `index.html` (stub `pdfjsLib`,
`ShiftParser`, `document`) and run `node --check` on it.
