# SPEC.md — Shift Compare

## Purpose

Upload (or auto-load) a monthly "Shift Table" PDF, pick a date on a calendar, see
who works that day and on which shift; find dates where selected people share a shift.

## Shift codes

| Code | Meaning     | Counts as working |
|------|-------------|-------------------|
| A    | Day Shift   | yes               |
| B    | Night Shift | yes               |
| T    | Training    | yes               |
| H    | Holiday/off | no                |

**Overtime**: each employee has a second `OT` row. A letter there is the shift type
of the OT (e.g. `B` = OT night shift). A person rostered `H` but with an OT mark is
working ("called in"). The PDF's own `Total A/B` rows include OT called-ins — the
app matches those totals exactly (verified for all 31 days of the July 2026 sample).

## PDF layout (measured facts, July 2026 sample)

- A4 portrait, 595.32 × 841.92 pt, single page, one month per page.
- Title: `Shift Table : <Month> <Year>` (~y 167).
- Day header row (~y 191): integers 1–31 left→right, first column x ≈ 152.9,
  step ≈ 12.23 pt. Weekday letters are rotated text — ignored.
- Employee block = two rows:
  - `Shift` label (x ≈ 130.7) + one code per day column, same y as label
  - `OT` label (x ≈ 132.6) ~7 pt below + optional codes per day column
- Name cell (x < 128) spans the block: line 1 = ID/role (`FOC - 07 (B3)` or
  `FOC - 02 (A2) - RYG`), line 2 = name (`SOMCHAI / ตัวอย่าง` — Thai nicknames common).
- Bottom rows `Total A` / `Total B` (label `Total` at x ≈ 68) — excluded from parsing.
- Cells can be blank (mid-month joiners/leavers); `Vacant` rows have no codes.
- Plain text extraction is scrambled — **coordinates are mandatory**.

## Parsing algorithm (`parser.js`)

Input: `pages = [{ items: [{str, x, y, width}], pageHeight }]` where `y` is
top-down (`viewportHeight - transform[5]` from pdf.js).

1. Tokenize items into words; estimate each word's x-center from item start x +
   average glyph advance (`width / str.length`).
2. Day columns: the 3pt y-bucket holding the longest strictly-increasing run of
   integers 1..31 (must be ≥ 20). Each number's x-center = its column.
3. Column snap tolerance = 0.55 × column step.
4. Every `Shift` token left of the grid starts an employee; codes = `[A-Z]{1,2}`
   tokens within ±3.5 pt of its y, snapped to nearest column.
5. `OT` labels between this Shift row and the next (y + 1 .. y + 13): marks are
   `[A-Z0-9]{1,3}` tokens (≠ "OT") on that line, snapped the same way.
6. Name: tokens with x < firstColX − 30 within [y − 3, blockEnd], grouped into
   lines by y (< 3 pt); line 1 → `id`, line 2 → `name`.
7. Rows at/below the first `Total` label y are cut off.
8. Month/year: a month-name token with a `(19|20)\d{2}` token within 4 pt y.
9. Multi-page: parse each page, concat employees, first month/year wins.

Output: `{ month, year, monthName, employees: [{ id, name, shifts: {day: code}, ot: {day: code} }] }`.
Throws if no shift rows found.

## App behavior (`index.html`)

- **Load**: drag-drop, file picker, or "Load shift.pdf" (fetches `./shift.pdf`;
  fails gracefully when absent, e.g. on the public site). "Reload shift.pdf" in
  the filebar re-fetches. All parsing in-browser via pdf.js 3.11.174 (cdnjs CDN,
  worker URL set explicitly).
- **Calendar**: month from the PDF, Sun-first grid. Each day shows on-duty count;
  a dot = someone has OT that day. Click → detail panel.
- **Detail panel**: full date, stat tiles (On duty / Day / Night / Overtime),
  sections Day Shift / Night Shift / Training with person rows (avatar initials,
  name, ID), collapsible Off/Holiday list. Effective shift for "on duty" =
  rostered A/B/T, else OT code if A/B/T.
- **Badges**: outlined `OT · <shift>` for OT on top of a rostered shift; solid
  `Called in` when the person is otherwise off. Grayscale only.
- **Who works together**: chips for every non-vacant employee, label = nickname
  (text after `/`) else first word; tooltip = full name + ID. With ≥ 2 selected,
  list all dates where every selected person's effective shift is identical
  (A/B/T). Rows show date + shift badge (+ `OT` if any member is OT); click
  jumps to that day. Matching days get an inset ring on the calendar. No match →
  "X + Y never share a shift this month."

## Design system

Strict monochrome macOS look: white window on light-gray radial background,
traffic-light dots (grays), 18px window / 14px card radii, layered soft shadows,
`-apple-system` font stack, grayscale palette in `:root` CSS variables
(`--ink #111113`, `--text`, `--text-2`, `--text-3`, `--border`, `--surface-2`).
Never introduce color.

## Hosting

GitHub Pages, repo `UIVusual/shift-compare` (public), `main` branch root,
https://uivusual.github.io/shift-compare/. `shift.pdf` is git-ignored — users
supply their own PDF; nothing is uploaded to any server.

## Ideas / backlog

- Multi-month: accept several PDFs, month switcher in calendar header
- Export a person's month (ICS calendar file)
- "Same day" (not just same shift) toggle in who-works-together
- Per-person view: click a name → their whole month highlighted
- Dark mode variant (still monochrome, inverted)
