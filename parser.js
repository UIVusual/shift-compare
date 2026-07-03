/*
 * parser.js — coordinate-based parser for the "Shift Table" PDF.
 *
 * Works on the text items produced by pdf.js getTextContent().
 * Layout facts (measured from the real PDF):
 *   - Title row:   "Shift Table : <Month> <Year>"
 *   - Header row:  day numbers 1..31 laid out left-to-right (~12.2pt apart)
 *   - Each employee block is two rows:
 *       "Shift" label (x ~130) + one code per day column (A/B/T/H)
 *       "OT"    label (x ~132) + optional code per day column (shift type of the OT)
 *   - Name cell (x < 128) spans both rows: line 1 = ID/role, line 2 = name
 *   - Bottom "Total A" / "Total B" rows must be ignored ("Total" label at x ~68)
 *
 * Exposed API (browser global + CommonJS):
 *   parseShiftSchedule(pages) -> { month, year, monthName, days: {...}, employees: [...] }
 *     pages: array of { items: [{str, x, y, width}], pageHeight }
 *            where y is measured from the TOP of the page (top-down).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  var SHIFT_LABELS = { A: 'Day Shift', B: 'Night Shift', T: 'Training', H: 'Holiday' };

  // Split a pdf.js text item into word tokens, estimating each token's
  // x-center from the item's start x and average glyph advance.
  function tokenize(item) {
    var tokens = [];
    var str = item.str;
    if (!str || !str.trim()) return tokens;
    var advance = str.length > 0 ? item.width / str.length : 0;
    var re = /\S+/g, m;
    while ((m = re.exec(str)) !== null) {
      var startX = item.x + m.index * advance;
      var w = m[0].length * advance;
      tokens.push({ text: m[0], x: startX, xc: startX + w / 2, y: item.y });
    }
    return tokens;
  }

  // Find the header row: the y-band holding the longest increasing run of
  // integers 1..31. Returns { colX: {day: xCenter}, y }.
  function findDayColumns(tokens) {
    var byY = {};
    tokens.forEach(function (t) {
      if (!/^\d{1,2}$/.test(t.text)) return;
      var n = parseInt(t.text, 10);
      if (n < 1 || n > 31) return;
      var key = Math.round(t.y / 3) * 3; // 3pt y-bucket
      (byY[key] = byY[key] || []).push({ day: n, xc: t.xc });
    });
    var best = null, bestY = null;
    Object.keys(byY).forEach(function (key) {
      var list = byY[key].slice().sort(function (a, b) { return a.xc - b.xc; });
      // count strictly-increasing day sequence
      var run = 0, prev = 0;
      list.forEach(function (e) { if (e.day === prev + 1) { run++; prev = e.day; } });
      if (best === null || run > best.run) { best = { run: run, list: list }; bestY = +key; }
    });
    if (!best || best.run < 20) return null;
    var colX = {};
    var prev = 0;
    best.list.forEach(function (e) {
      if (e.day === prev + 1) { colX[e.day] = e.xc; prev = e.day; }
    });
    return { colX: colX, y: bestY };
  }

  function nearestDay(colX, xc, tolerance) {
    var bestDay = null, bestDist = Infinity;
    for (var d in colX) {
      var dist = Math.abs(colX[d] - xc);
      if (dist < bestDist) { bestDist = dist; bestDay = +d; }
    }
    return bestDist <= tolerance ? bestDay : null;
  }

  function findMonthYear(tokens) {
    // Look for "<Month> <Year>" among tokens (title row); tolerate splits.
    for (var i = 0; i < tokens.length; i++) {
      var idx = MONTHS.findIndex(function (mn) {
        return tokens[i].text.toLowerCase() === mn.toLowerCase();
      });
      if (idx === -1) continue;
      // year should be a nearby token on roughly the same line
      for (var j = 0; j < tokens.length; j++) {
        if (Math.abs(tokens[j].y - tokens[i].y) < 4 && /^(19|20)\d{2}$/.test(tokens[j].text)) {
          return { month: idx + 1, year: parseInt(tokens[j].text, 10), monthName: MONTHS[idx] };
        }
      }
    }
    return null;
  }

  function parsePage(page) {
    var tokens = [];
    page.items.forEach(function (it) { tokens.push.apply(tokens, tokenize(it)); });

    var header = findDayColumns(tokens);
    if (!header) return null;
    var colX = header.colX;
    var days = Object.keys(colX).map(Number);
    var firstColX = Math.min.apply(null, days.map(function (d) { return colX[d]; }));
    var colStep = days.length > 1
      ? (colX[Math.max.apply(null, days)] - firstColX) / (Math.max.apply(null, days) - Math.min.apply(null, days))
      : 12.2;
    var tol = colStep * 0.55;

    var monthYear = findMonthYear(tokens);

    // Label tokens
    var shiftLabels = tokens.filter(function (t) {
      return t.text === 'Shift' && t.x < firstColX - 10 && t.y > header.y;
    }).sort(function (a, b) { return a.y - b.y; });

    var otLabels = tokens.filter(function (t) {
      return t.text === 'OT' && t.x < firstColX - 10 && t.y > header.y;
    });

    var totalLabels = tokens.filter(function (t) { return t.text === 'Total'; });
    var totalCutY = totalLabels.length
      ? Math.min.apply(null, totalLabels.map(function (t) { return t.y; })) - 4
      : Infinity;

    var nameZoneMax = firstColX - 30; // name cell lives well left of the grid

    var employees = [];
    shiftLabels.forEach(function (lab, i) {
      if (lab.y > totalCutY) return;
      var yS = lab.y;
      var nextY = i + 1 < shiftLabels.length ? shiftLabels[i + 1].y : Math.min(totalCutY, yS + 15);
      var blockEnd = Math.min(nextY - 2, yS + 13);

      // shift codes on this row
      var shifts = {};
      tokens.forEach(function (t) {
        if (Math.abs(t.y - yS) > 3.5) return;
        if (t.xc < firstColX - tol) return;
        if (!/^[A-Z]{1,2}$/.test(t.text)) return;
        var d = nearestDay(colX, t.xc, tol);
        if (d !== null) shifts[d] = t.text;
      });

      // OT row: the OT label sitting between this Shift row and the next
      var ot = {};
      otLabels.forEach(function (otLab) {
        if (otLab.y <= yS + 1 || otLab.y >= yS + 13) return;
        tokens.forEach(function (t) {
          if (Math.abs(t.y - otLab.y) > 3.5) return;
          if (t.xc < firstColX - tol) return;
          if (!/^[A-Z0-9]{1,3}$/.test(t.text) || t.text === 'OT') return;
          var d = nearestDay(colX, t.xc, tol);
          if (d !== null) ot[d] = t.text;
        });
      });

      // name cell: tokens left of the grid within the block's y-range
      var nameTokens = tokens.filter(function (t) {
        return t.x < nameZoneMax && t.y >= yS - 3 && t.y <= blockEnd &&
          t.text !== 'Total';
      }).sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });

      // group into lines by y
      var lines = [];
      nameTokens.forEach(function (t) {
        var line = lines.find(function (L) { return Math.abs(L.y - t.y) < 3; });
        if (!line) { line = { y: t.y, parts: [] }; lines.push(line); }
        line.parts.push(t.text);
      });
      lines.sort(function (a, b) { return a.y - b.y; });
      var lineTexts = lines.map(function (L) { return L.parts.join(' ').replace(/\s+-\s+/g, ' - '); });

      var idLine = lineTexts[0] || '';
      var nameLine = lineTexts[1] || '';
      if (!nameLine && idLine) { nameLine = idLine; idLine = ''; }

      employees.push({
        id: idLine.trim(),
        name: nameLine.trim() || '(unnamed)',
        shifts: shifts,
        ot: ot
      });
    });

    return { monthYear: monthYear, employees: employees };
  }

  function parseShiftSchedule(pages) {
    var monthYear = null;
    var employees = [];
    pages.forEach(function (page) {
      var res = parsePage(page);
      if (!res) return;
      if (!monthYear && res.monthYear) monthYear = res.monthYear;
      employees = employees.concat(res.employees);
    });
    if (!employees.length) {
      throw new Error('No shift rows found. The PDF layout does not match the expected "Shift Table" format.');
    }
    return {
      month: monthYear ? monthYear.month : null,
      year: monthYear ? monthYear.year : null,
      monthName: monthYear ? monthYear.monthName : null,
      employees: employees
    };
  }

  return {
    parseShiftSchedule: parseShiftSchedule,
    SHIFT_LABELS: SHIFT_LABELS,
    MONTHS: MONTHS
  };
});
