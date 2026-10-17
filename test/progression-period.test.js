const test = require("node:test");
const assert = require("node:assert/strict");

const { dateKey } = require("../common.js");
const { periodRange, buildPeriodDays, summarizePeriod } = require("../progression-ui.js");

test("periodRange: week runs Monday to Sunday, month is the calendar month", () => {
  const week = periodRange("week", 0, "2026-10-18"); // a Sunday
  assert.equal(dateKey(week.start), "2026-10-12");
  assert.equal(dateKey(week.end), "2026-10-18");
  const prev = periodRange("week", -1, "2026-10-18");
  assert.equal(dateKey(prev.start), "2026-10-05");

  const month = periodRange("month", 0, "2026-10-18");
  assert.equal(dateKey(month.start), "2026-10-01");
  assert.equal(dateKey(month.end), "2026-10-31");
  assert.equal(dateKey(periodRange("month", -10, "2026-10-18").start), "2025-12-01");
});

test("buildPeriodDays + summarizePeriod: settled days, unsettled days, today live, future", () => {
  const state = {
    today: { date: "2026-10-14" },
    days: [
      { d: "2026-10-12", t: 3600, p: 2400, g: 600, l: 600, f: 63, c1: 1, c2: 1, c3: 1, h: 1, a: 0 },
      // older record without `g`: general is derived
      { d: "2026-10-13", t: 1800, p: 0, l: 1800, f: 0, c1: 1, c2: 0, c3: 0, h: 0, a: 0 },
    ],
  };
  const sites = {
    "github.com": { macroCategory: "Productivity", microCategory: "Development", lastReset: "2026-10-14", usedSeconds: 1200 },
  };
  const { start, end } = periodRange("week", 0, "2026-10-14");
  const days = buildPeriodDays(state, sites, start, end);

  assert.equal(days.length, 7);
  assert.equal(days[0].status, "held");
  assert.equal(days[1].status, "partial");
  assert.equal(days[1].g, 0);
  assert.equal(days[2].live, true);
  assert.equal(days[2].p, 1200);
  assert.equal(days[3].status, "future");

  const sum = summarizePeriod(days);
  assert.equal(sum.t, 3600 + 1800 + 1200);
  assert.equal(sum.active, 3);
  assert.equal(sum.settled, 2); // today is live, never counted as held yet
  assert.equal(sum.held, 1);
  // (3600/6600)*100 - (2400/6600)*25 = 54.5 - 9.1 = 45.5 → 45
  assert.equal(sum.focus, 45);
  assert.equal(sum.dailyAvg, 2200);
});

test("summarizePeriod: an empty period has no focus score, not 100", () => {
  const sum = summarizePeriod([]);
  assert.equal(sum.focus, null);
  assert.equal(sum.dailyAvg, 0);
});
