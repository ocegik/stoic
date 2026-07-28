const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEVEL_BASE_COST,
  LEVEL_COST_STEP,
  XP_STREAK_CAP,
  XP_REFUSAL_DAILY_CAP,
  cumulativeXpForLevel,
  levelForXp,
  xpProgressForLevel,
  rankForLevel,
  isoWeekKey,
  monthKey,
  isWeekEnd,
  isMonthEnd,
  lastNDays,
  consecutiveFrom,
  evaluateConditions,
  advanceStreak,
  advanceRuleStreak,
  computeDayXp,
  computeWeekXp,
  registerDayXpRule,
  DAY_XP_RULES,
  ACHIEVEMENTS,
  registerAchievement,
  RECORDS,
  registerRecord,
  evaluateRecords,
  maxRuleStreakValue,
  maxRuleStreakDomain,
} = require("../progression-model.js");

const DEFAULT_CONFIG = { leisureCeilingMinutes: 60, focusTarget: 60, minTrackedMinutesForFocus: 30 };

function baseLifetime(overrides) {
  return {
    firstDay: "2026-01-01",
    daysTracked: 0,
    daysHeld: 0,
    trackedSeconds: 0,
    productiveSeconds: 0,
    generalSeconds: 0,
    leisureSeconds: 0,
    gatesShown: 0,
    gatesPassed: 0,
    refusals: 0,
    violations: 0,
    rulesCreated: 0,
    rulesLoosened: 0,
    xpFromDays: 0,
    xpFromWeeks: 0,
    xpFromAchievements: 0,
    ...overrides,
  };
}

function baseStreaks(overrides) {
  return {
    discipline: {
      current: 0,
      currentStart: null,
      best: 0,
      bestStart: null,
      bestEnd: null,
      lastHeldDate: null,
      lastBrokenFrom: 0,
      ...(overrides && overrides.discipline),
    },
    rules: (overrides && overrides.rules) || {},
  };
}

function makeDay(overrides) {
  return {
    d: "2026-07-27",
    t: 0,
    p: 0,
    g: 0,
    l: 0,
    f: 0,
    c1: 1,
    c2: 1,
    c3: 1,
    h: 0,
    a: 0,
    v: 0,
    gs: 0,
    gp: 0,
    r: 0,
    ar: 0,
    xp: 0,
    st: 0,
    ...overrides,
  };
}

function makeCtx(overrides = {}) {
  return {
    day: makeDay(overrides.day),
    days: overrides.days || [],
    weeks: overrides.weeks || [],
    months: overrides.months || [],
    streaks: baseStreaks(overrides.streaks),
    lifetime: baseLifetime(overrides.lifetime),
    config: DEFAULT_CONFIG,
    dayKey: overrides.dayKey || "2026-07-27",
  };
}

function achievement(id) {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  assert.ok(def, `achievement ${id} must exist`);
  return def;
}

// ---------- 1.2 level curve ----------

test("cumulativeXpForLevel: matches the required boundary values", () => {
  assert.equal(cumulativeXpForLevel(2), 100);
  assert.equal(cumulativeXpForLevel(3), 260);
  assert.equal(cumulativeXpForLevel(4), 480);
  assert.equal(cumulativeXpForLevel(5), 760);
  assert.equal(cumulativeXpForLevel(10), 3060);
  assert.equal(cumulativeXpForLevel(20), 12160);
  assert.equal(cumulativeXpForLevel(40), 48360);
});

test("levelForXp: matches the required boundary values and never returns below 1", () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(759), 4);
  assert.equal(levelForXp(760), 5);
});

test("level curve: cost deltas and the levelForXp inverse hold for levels 1..60", () => {
  for (let L = 1; L <= 60; L++) {
    assert.equal(
      cumulativeXpForLevel(L + 1) - cumulativeXpForLevel(L),
      LEVEL_BASE_COST + LEVEL_COST_STEP * (L - 1),
      `cost(${L} -> ${L + 1})`
    );
    assert.equal(levelForXp(cumulativeXpForLevel(L)), L, `levelForXp at floor of L${L}`);
    assert.equal(levelForXp(cumulativeXpForLevel(L + 1) - 1), L, `levelForXp just below L${L + 1}`);
  }
});

test("rankForLevel: maps every level band correctly, including the open-ended top band", () => {
  const cases = [
    [1, "observer"],
    [5, "observer"],
    [6, "deliberate"],
    [10, "deliberate"],
    [11, "measured"],
    [15, "measured"],
    [16, "consistent"],
    [20, "consistent"],
    [21, "disciplined"],
    [25, "disciplined"],
    [26, "tempered"],
    [30, "tempered"],
    [31, "composed"],
    [35, "composed"],
    [36, "self_governed"],
    [100, "self_governed"],
  ];
  for (const [level, id] of cases) {
    assert.equal(rankForLevel(level).id, id, `level ${level}`);
  }
});

test("xpProgressForLevel: reports level, rank, xp into/for the level, and pct", () => {
  const p = xpProgressForLevel(150); // level 2 spans [100, 260)
  assert.equal(p.level, 2);
  assert.equal(p.rank.id, "observer");
  assert.equal(p.xpIntoLevel, 50);
  assert.equal(p.xpForNextLevel, 160);
  assert.ok(Math.abs(p.pct - (50 / 160) * 100) < 1e-9);
});

// ---------- 1.3 date/period helpers ----------

test("isoWeekKey: correct across year boundaries and for a mid-year Monday/Sunday pair", () => {
  assert.equal(isoWeekKey("2026-01-01"), "2026-W01");
  assert.equal(isoWeekKey("2025-12-29"), "2026-W01"); // Monday of the same ISO week
  assert.equal(isoWeekKey("2026-12-31"), "2026-W53");
  assert.equal(isoWeekKey("2026-12-28"), "2026-W53");
  assert.equal(isoWeekKey("2026-07-27"), "2026-W31"); // Monday
  assert.equal(isoWeekKey("2026-07-26"), "2026-W30"); // preceding Sunday, prior week
});

test("monthKey: formats YYYY-MM", () => {
  assert.equal(monthKey("2026-07-27"), "2026-07");
  assert.equal(monthKey("2026-01-05"), "2026-01");
});

test("isWeekEnd: true only on Sunday", () => {
  assert.equal(isWeekEnd("2026-07-26"), true);
  assert.equal(isWeekEnd("2026-07-27"), false);
});

test("isMonthEnd: true only on the last calendar day of the month", () => {
  assert.equal(isMonthEnd("2026-07-31"), true);
  assert.equal(isMonthEnd("2026-07-30"), false);
  assert.equal(isMonthEnd("2026-02-28"), true); // 2026 is not a leap year
});

test("lastNDays: returns the trailing slice, or the whole array if shorter than n", () => {
  const days = [1, 2, 3, 4, 5];
  assert.deepEqual(lastNDays(days, 3), [3, 4, 5]);
  assert.deepEqual(lastNDays(days, 10), [1, 2, 3, 4, 5]);
});

test("consecutiveFrom: counts the run ending at the newest entry, stopping at the first failure", () => {
  const days = [{ v: 1 }, { v: 1 }, { v: 0 }, { v: 1 }, { v: 1 }, { v: 1 }];
  assert.equal(consecutiveFrom(days, (d) => d.v === 1), 3);
  assert.equal(consecutiveFrom([], () => true), 0);
});

// ---------- 1.4 day conditions ----------

test("evaluateConditions: a fully held day", () => {
  const snapshot = { trackedSeconds: 5000, leisureSeconds: 100, focusScore: 75, violations: 0, gatesShown: 1 };
  assert.deepEqual(evaluateConditions(snapshot, DEFAULT_CONFIG), {
    absent: false,
    c1: true,
    c2: true,
    c3: true,
    focusWaived: false,
    held: true,
  });
});

test("evaluateConditions: a partial day (leisure over ceiling) is not held", () => {
  const snapshot = { trackedSeconds: 5000, leisureSeconds: 4000, focusScore: 75, violations: 0, gatesShown: 0 };
  const c = evaluateConditions(snapshot, DEFAULT_CONFIG);
  assert.equal(c.c2, false);
  assert.equal(c.held, false);
});

test("evaluateConditions: an absent day reports every condition false, not just held", () => {
  const snapshot = { trackedSeconds: 0, leisureSeconds: 0, focusScore: 0, violations: 0, gatesShown: 0 };
  assert.deepEqual(evaluateConditions(snapshot, DEFAULT_CONFIG), {
    absent: true,
    c1: false,
    c2: false,
    c3: false,
    focusWaived: false,
    held: false,
  });
});

test("evaluateConditions: focus is waived under the minimum tracked minutes and counts as met", () => {
  const snapshot = { trackedSeconds: 600, leisureSeconds: 0, focusScore: 5, violations: 0, gatesShown: 0 };
  const c = evaluateConditions(snapshot, DEFAULT_CONFIG);
  assert.equal(c.focusWaived, true);
  assert.equal(c.c3, true);
});

test("evaluateConditions: adherence is vacuously true with no violations recorded (no active rules)", () => {
  const snapshot = { trackedSeconds: 5000, leisureSeconds: 100, focusScore: 75, violations: 0, gatesShown: 0 };
  assert.equal(evaluateConditions(snapshot, DEFAULT_CONFIG).c1, true);
});

// ---------- 1.5 streak transitions ----------

test("advanceStreak: absent day is a complete no-op", () => {
  const s = {
    current: 5,
    currentStart: "2026-07-20",
    best: 5,
    bestStart: "2026-07-20",
    bestEnd: "2026-07-24",
    lastHeldDate: "2026-07-24",
    lastBrokenFrom: 0,
  };
  assert.deepEqual(advanceStreak(s, { held: false, absent: true }, "2026-07-25"), s);
});

test("advanceStreak: held day extends the run and sets a new best", () => {
  const s = {
    current: 5,
    currentStart: "2026-07-20",
    best: 5,
    bestStart: "2026-07-20",
    bestEnd: "2026-07-24",
    lastHeldDate: "2026-07-24",
    lastBrokenFrom: 0,
  };
  const next = advanceStreak(s, { held: true, absent: false }, "2026-07-25");
  assert.equal(next.current, 6);
  assert.equal(next.currentStart, "2026-07-20");
  assert.equal(next.best, 6);
  assert.equal(next.bestStart, "2026-07-20");
  assert.equal(next.bestEnd, "2026-07-25");
  assert.equal(next.lastHeldDate, "2026-07-25");
});

test("advanceStreak: held day that stays below the existing best leaves best/bestStart/bestEnd alone", () => {
  const s = {
    current: 0,
    currentStart: null,
    best: 31,
    bestStart: "2026-04-02",
    bestEnd: "2026-05-02",
    lastHeldDate: "2026-05-02",
    lastBrokenFrom: 31,
  };
  const next = advanceStreak(s, { held: true, absent: false }, "2026-07-25");
  assert.equal(next.current, 1);
  assert.equal(next.currentStart, "2026-07-25");
  assert.equal(next.best, 31);
  assert.equal(next.bestStart, "2026-04-02");
  assert.equal(next.bestEnd, "2026-05-02");
});

test("advanceStreak: breaking a run records lastBrokenFrom, resets current, and preserves best", () => {
  const s = {
    current: 14,
    currentStart: "2026-07-11",
    best: 14,
    bestStart: "2026-07-11",
    bestEnd: "2026-07-24",
    lastHeldDate: "2026-07-24",
    lastBrokenFrom: 0,
  };
  const next = advanceStreak(s, { held: false, absent: false }, "2026-07-25");
  assert.equal(next.current, 0);
  assert.equal(next.currentStart, null);
  assert.equal(next.lastBrokenFrom, 14);
  assert.equal(next.best, 14);
});

test("advanceStreak: not held with current already zero is a no-op", () => {
  const s = {
    current: 0,
    currentStart: null,
    best: 10,
    bestStart: "2026-01-01",
    bestEnd: "2026-01-10",
    lastHeldDate: "2026-01-10",
    lastBrokenFrom: 5,
  };
  assert.deepEqual(advanceStreak(s, { held: false, absent: false }, "2026-07-25"), s);
});

test("advanceRuleStreak: an off-schedule day neither extends nor breaks the run", () => {
  const s = { current: 5, best: 5, lastDate: "2026-07-24" };
  assert.deepEqual(advanceRuleStreak(s, { respected: false, scheduled: false }, "2026-07-25"), s);
  assert.deepEqual(advanceRuleStreak(s, { respected: true, scheduled: false }, "2026-07-25"), s);
});

test("advanceRuleStreak: a respected scheduled day extends the run and best", () => {
  const s = { current: 5, best: 5, lastDate: "2026-07-24" };
  const next = advanceRuleStreak(s, { respected: true, scheduled: true }, "2026-07-25");
  assert.deepEqual(next, { current: 6, best: 6, lastDate: "2026-07-25" });
});

test("advanceRuleStreak: a violated scheduled day resets current but keeps best", () => {
  const s = { current: 5, best: 22, lastDate: "2026-07-24" };
  const next = advanceRuleStreak(s, { respected: false, scheduled: true }, "2026-07-25");
  assert.deepEqual(next, { current: 0, best: 22, lastDate: "2026-07-24" });
});

// ---------- 1.6 XP rules registry ----------

test("computeDayXp: a fully held day sums condition XP, the held bonus, and the streak bonus", () => {
  const ctx = {
    snapshot: { refusals: 0 },
    conditions: { c1: true, c2: true, c3: true, held: true, absent: false },
    streakAfter: 3,
  };
  const { total, breakdown } = computeDayXp(ctx);
  assert.equal(total, 25 + 25 + 25 + 25 + 6);
  assert.equal(breakdown.length, 5);
});

test("computeDayXp: the streak bonus caps at XP_STREAK_CAP on a long streak", () => {
  const ctx = {
    snapshot: { refusals: 0 },
    conditions: { c1: true, c2: true, c3: true, held: true, absent: false },
    streakAfter: 100,
  };
  const { breakdown } = computeDayXp(ctx);
  assert.equal(breakdown.find((b) => b.id === "streak").xp, XP_STREAK_CAP);
});

test("computeDayXp: refusal XP caps at XP_REFUSAL_DAILY_CAP", () => {
  const ctx = {
    snapshot: { refusals: 5 }, // 5 * 10 = 50, capped to 30
    conditions: { c1: false, c2: false, c3: false, held: false, absent: false },
    streakAfter: 0,
  };
  const { total, breakdown } = computeDayXp(ctx);
  assert.equal(total, XP_REFUSAL_DAILY_CAP);
  assert.deepEqual(breakdown, [{ id: "refusals", label: "Turned back", xp: XP_REFUSAL_DAILY_CAP }]);
});

test("computeDayXp: an absent day earns nothing regardless of other fields", () => {
  const ctx = { snapshot: { refusals: 3 }, conditions: { absent: true }, streakAfter: 10 };
  assert.deepEqual(computeDayXp(ctx), { total: 0, breakdown: [] });
});

test("computeWeekXp: tiers at 5/6/7 held days, zero below 5, tiers replace rather than stack", () => {
  assert.deepEqual(computeWeekXp(4), { xp: 0, tier: 0 });
  assert.deepEqual(computeWeekXp(5), { xp: 75, tier: 5 });
  assert.deepEqual(computeWeekXp(6), { xp: 110, tier: 6 });
  assert.deepEqual(computeWeekXp(7), { xp: 150, tier: 7 });
});

test("registerDayXpRule: pushes a new rule that computeDayXp picks up", () => {
  const before = DAY_XP_RULES.length;
  registerDayXpRule({ id: "__test_bonus", label: "Test bonus", compute: () => 7 });
  try {
    const ctx = {
      snapshot: { refusals: 0 },
      conditions: { c1: false, c2: false, c3: false, held: false, absent: false },
      streakAfter: 0,
    };
    const { total, breakdown } = computeDayXp(ctx);
    assert.equal(total, 7);
    assert.ok(breakdown.some((b) => b.id === "__test_bonus"));
  } finally {
    DAY_XP_RULES.length = before; // undo, so later tests see the stock registry
  }
});

// ---------- 1.7 achievements ----------

test("ACHIEVEMENTS: catalogue has exactly the 27 documented ids, each with a working test()", () => {
  const ids = [
    "first_rule",
    "first_week",
    "clean_week",
    "clean_fortnight",
    "clean_month",
    "clean_quarter",
    "clean_year",
    "first_refusal",
    "refusals_10",
    "refusals_50",
    "refusals_250",
    "silent_day",
    "quiet_week",
    "silent_week",
    "deep_day",
    "deep_week",
    "unbroken_30",
    "ironclad_100",
    "days_30",
    "days_100",
    "days_365",
    "days_1000",
    "productive_100h",
    "productive_500h",
    "productive_1000h",
    "downward_trend",
    "back_on",
  ];
  assert.equal(ACHIEVEMENTS.length, 27);
  assert.deepEqual(
    ACHIEVEMENTS.map((a) => a.id),
    ids
  );
});

test("achievement first_rule: fires once a rule has been created", () => {
  const def = achievement("first_rule");
  assert.equal(def.test(makeCtx({ lifetime: { rulesCreated: 1 } })), true);
  assert.equal(def.test(makeCtx({ lifetime: { rulesCreated: 0 } })), false);
});

test("achievement first_week: fires at 7 days tracked", () => {
  const def = achievement("first_week");
  assert.equal(def.test(makeCtx({ lifetime: { daysTracked: 7 } })), true);
  assert.equal(def.test(makeCtx({ lifetime: { daysTracked: 6 } })), false);
});

test("achievement clean_week: fires at a 7-day discipline streak", () => {
  const def = achievement("clean_week");
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 7 } } })), true);
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 6 } } })), false);
});

test("achievement clean_fortnight: fires at a 14-day discipline streak", () => {
  const def = achievement("clean_fortnight");
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 14 } } })), true);
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 13 } } })), false);
});

test("achievement clean_month: fires at a 30-day discipline streak", () => {
  const def = achievement("clean_month");
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 30 } } })), true);
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 29 } } })), false);
});

test("achievement clean_quarter: fires at a 90-day discipline streak", () => {
  const def = achievement("clean_quarter");
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 90 } } })), true);
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 89 } } })), false);
});

test("achievement clean_year: fires at a 365-day discipline streak", () => {
  const def = achievement("clean_year");
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 365 } } })), true);
  assert.equal(def.test(makeCtx({ streaks: { discipline: { current: 364 } } })), false);
});

test("achievement first_refusal: fires on the first lifetime refusal", () => {
  const def = achievement("first_refusal");
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 1 } })), true);
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 0 } })), false);
});

test("achievement refusals_10: fires at 10 lifetime refusals", () => {
  const def = achievement("refusals_10");
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 10 } })), true);
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 9 } })), false);
});

test("achievement refusals_50: fires at 50 lifetime refusals", () => {
  const def = achievement("refusals_50");
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 50 } })), true);
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 49 } })), false);
});

test("achievement refusals_250: fires at 250 lifetime refusals", () => {
  const def = achievement("refusals_250");
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 250 } })), true);
  assert.equal(def.test(makeCtx({ lifetime: { refusals: 249 } })), false);
});

test("achievement silent_day: a tracked day with zero leisure seconds", () => {
  const def = achievement("silent_day");
  assert.equal(def.test(makeCtx({ day: { a: 0, t: 600, l: 0 } })), true);
  assert.equal(def.test(makeCtx({ day: { a: 0, t: 600, l: 60 } })), false); // leisure > 0
  assert.equal(def.test(makeCtx({ day: { a: 1, t: 0, l: 0 } })), false); // absent day doesn't qualify
});

test("achievement quiet_week: 7 consecutive days with leisure at or under 30 minutes", () => {
  const def = achievement("quiet_week");
  const passDays = Array.from({ length: 7 }, () => ({ a: 0, l: 1000 }));
  const failDays = Array.from({ length: 6 }, () => ({ a: 0, l: 1000 })); // only 6 in a row
  assert.equal(def.test(makeCtx({ days: passDays })), true);
  assert.equal(def.test(makeCtx({ days: failDays })), false);
});

test("achievement silent_week: 7 consecutive days with zero leisure", () => {
  const def = achievement("silent_week");
  const passDays = Array.from({ length: 7 }, () => ({ a: 0, l: 0 }));
  const failDays = [...Array.from({ length: 6 }, () => ({ a: 0, l: 0 })), { a: 0, l: 60 }]; // trailing day breaks it
  assert.equal(def.test(makeCtx({ days: passDays })), true);
  assert.equal(def.test(makeCtx({ days: failDays })), false);
});

test("achievement deep_day: focus 90+ on a day with at least 2 hours tracked", () => {
  const def = achievement("deep_day");
  assert.equal(def.test(makeCtx({ day: { f: 90, t: 7200 } })), true);
  assert.equal(def.test(makeCtx({ day: { f: 85, t: 7200 } })), false); // focus too low
  assert.equal(def.test(makeCtx({ day: { f: 95, t: 3600 } })), false); // not enough tracked time
});

test("achievement deep_week: trailing 7-day mean focus >= 80 over at least 5 tracked days", () => {
  const def = achievement("deep_week");
  const passDays = [
    { a: 1, f: 0 },
    { a: 1, f: 0 },
    { a: 0, f: 90 },
    { a: 0, f: 90 },
    { a: 0, f: 90 },
    { a: 0, f: 90 },
    { a: 0, f: 90 },
  ];
  const failDaysLowMean = passDays.map((d) => (d.a === 0 ? { ...d, f: 70 } : d)); // mean 70 < 80
  const failDaysTooFewTracked = [
    { a: 1, f: 0 },
    { a: 1, f: 0 },
    { a: 1, f: 0 },
    { a: 0, f: 100 },
    { a: 0, f: 100 },
    { a: 0, f: 100 },
    { a: 0, f: 100 },
  ]; // only 4 tracked days
  assert.equal(def.test(makeCtx({ days: passDays })), true);
  assert.equal(def.test(makeCtx({ days: failDaysLowMean })), false);
  assert.equal(def.test(makeCtx({ days: failDaysTooFewTracked })), false);
});

test("achievement unbroken_30: a single rule held 30 consecutive scheduled days", () => {
  const def = achievement("unbroken_30");
  assert.equal(def.test(makeCtx({ streaks: { rules: { "site.com": { current: 30 } } } })), true);
  assert.equal(def.test(makeCtx({ streaks: { rules: { "site.com": { current: 29 } } } })), false);
});

test("achievement ironclad_100: a single rule held 100 consecutive scheduled days", () => {
  const def = achievement("ironclad_100");
  assert.equal(def.test(makeCtx({ streaks: { rules: { "site.com": { current: 100 } } } })), true);
  assert.equal(def.test(makeCtx({ streaks: { rules: { "site.com": { current: 99 } } } })), false);
});

test("achievement days_30/100/365/1000: milestone thresholds on lifetime.daysTracked", () => {
  assert.equal(achievement("days_30").test(makeCtx({ lifetime: { daysTracked: 30 } })), true);
  assert.equal(achievement("days_30").test(makeCtx({ lifetime: { daysTracked: 29 } })), false);
  assert.equal(achievement("days_100").test(makeCtx({ lifetime: { daysTracked: 100 } })), true);
  assert.equal(achievement("days_100").test(makeCtx({ lifetime: { daysTracked: 99 } })), false);
  assert.equal(achievement("days_365").test(makeCtx({ lifetime: { daysTracked: 365 } })), true);
  assert.equal(achievement("days_365").test(makeCtx({ lifetime: { daysTracked: 364 } })), false);
  assert.equal(achievement("days_1000").test(makeCtx({ lifetime: { daysTracked: 1000 } })), true);
  assert.equal(achievement("days_1000").test(makeCtx({ lifetime: { daysTracked: 999 } })), false);
});

test("achievement productive_100h/500h/1000h: milestone thresholds on lifetime.productiveSeconds", () => {
  assert.equal(achievement("productive_100h").test(makeCtx({ lifetime: { productiveSeconds: 100 * 3600 } })), true);
  assert.equal(
    achievement("productive_100h").test(makeCtx({ lifetime: { productiveSeconds: 100 * 3600 - 1 } })),
    false
  );
  assert.equal(achievement("productive_500h").test(makeCtx({ lifetime: { productiveSeconds: 500 * 3600 } })), true);
  assert.equal(
    achievement("productive_500h").test(makeCtx({ lifetime: { productiveSeconds: 500 * 3600 - 1 } })),
    false
  );
  assert.equal(
    achievement("productive_1000h").test(makeCtx({ lifetime: { productiveSeconds: 1000 * 3600 } })),
    true
  );
  assert.equal(
    achievement("productive_1000h").test(makeCtx({ lifetime: { productiveSeconds: 1000 * 3600 - 1 } })),
    false
  );
});

test("achievement downward_trend: 4 consecutive weeks each with less leisure than the week before", () => {
  const def = achievement("downward_trend");
  const decreasing = [{ l: 500 }, { l: 400 }, { l: 300 }, { l: 200 }, { l: 100 }];
  const notMonotonic = [{ l: 500 }, { l: 400 }, { l: 450 }, { l: 200 }, { l: 100 }];
  const tooFewWeeks = [{ l: 400 }, { l: 300 }, { l: 200 }, { l: 100 }];
  assert.equal(def.test(makeCtx({ weeks: decreasing })), true);
  assert.equal(def.test(makeCtx({ weeks: notMonotonic })), false);
  assert.equal(def.test(makeCtx({ weeks: tooFewWeeks })), false);
});

test("achievement back_on: a 7-day streak recovered after previously breaking one of 14+ days", () => {
  const def = achievement("back_on");
  assert.equal(
    def.test(makeCtx({ streaks: { discipline: { current: 7, lastBrokenFrom: 14 } } })),
    true
  );
  assert.equal(
    def.test(makeCtx({ streaks: { discipline: { current: 7, lastBrokenFrom: 13 } } })),
    false
  );
  assert.equal(
    def.test(makeCtx({ streaks: { discipline: { current: 6, lastBrokenFrom: 20 } } })),
    false
  );
});

test("achievements are one-shot by construction: test() is a pure predicate with no award/mutation side effect", () => {
  // Sanity check on the contract the engine relies on (I3/T2): calling test()
  // repeatedly against the same ctx must be idempotent.
  const def = achievement("clean_week");
  const ctx = makeCtx({ streaks: { discipline: { current: 7 } } });
  assert.equal(def.test(ctx), true);
  assert.equal(def.test(ctx), true);
});

test("registerAchievement: pushes a new definition onto the catalogue", () => {
  const before = ACHIEVEMENTS.length;
  registerAchievement({ id: "__test_ach", name: "Test", kind: "milestone", xp: 1, criterion: "test", test: () => true });
  try {
    assert.equal(ACHIEVEMENTS.length, before + 1);
    assert.equal(achievement("__test_ach").test(makeCtx()), true);
  } finally {
    ACHIEVEMENTS.length = before;
  }
});

// ---------- 1.8 personal records ----------

test("evaluateRecords: a max-direction day record is set, then only replaced by a strictly higher qualifying value", () => {
  const day1 = makeDay({ d: "2026-07-20", t: 4000, f: 70 });
  const { updated: r1 } = evaluateRecords({}, makeCtx({ day: day1, dayKey: "2026-07-20" }));
  assert.deepEqual(r1.best_focus_day, { value: 70, date: "2026-07-20", meta: null });

  const day2 = makeDay({ d: "2026-07-21", t: 4000, f: 65 }); // lower, should not replace
  const { updated: r2, beaten: b2 } = evaluateRecords(r1, makeCtx({ day: day2, dayKey: "2026-07-21" }));
  assert.deepEqual(r2.best_focus_day, { value: 70, date: "2026-07-20", meta: null });
  assert.equal(b2.includes("best_focus_day"), false);

  const day3 = makeDay({ d: "2026-07-22", t: 4000, f: 90 }); // higher, should replace
  const { updated: r3, beaten: b3 } = evaluateRecords(r2, makeCtx({ day: day3, dayKey: "2026-07-22" }));
  assert.deepEqual(r3.best_focus_day, { value: 90, date: "2026-07-22", meta: null });
  assert.ok(b3.includes("best_focus_day"));
});

test("evaluateRecords: a candidate failing its qualifier is skipped without touching the incumbent record", () => {
  const qualifyingDay = makeDay({ d: "2026-07-20", t: 4000, f: 95 }); // >=3600s tracked, qualifies
  const { updated: r1 } = evaluateRecords({}, makeCtx({ day: qualifyingDay, dayKey: "2026-07-20" }));
  assert.equal(r1.best_focus_day.value, 95);

  const disqualifiedDay = makeDay({ d: "2026-07-21", t: 100, f: 99 }); // higher score, but under the 1h qualifier
  const { updated: r2, beaten: b2 } = evaluateRecords(r1, makeCtx({ day: disqualifiedDay, dayKey: "2026-07-21" }));
  assert.deepEqual(r2.best_focus_day, r1.best_focus_day); // untouched
  assert.equal(b2.includes("best_focus_day"), false);
});

test("evaluateRecords: a min-direction record is set on first qualifying value, then only replaced by something strictly lower", () => {
  const day1 = makeDay({ d: "2026-07-20", t: 4000, l: 1800 });
  const { updated: r1 } = evaluateRecords({}, makeCtx({ day: day1, dayKey: "2026-07-20" }));
  assert.deepEqual(r1.lowest_leisure_day, { value: 1800, date: "2026-07-20", meta: null });

  const dayHigher = makeDay({ d: "2026-07-21", t: 4000, l: 2000 }); // higher leisure, should not replace a min record
  const { updated: r2 } = evaluateRecords(r1, makeCtx({ day: dayHigher, dayKey: "2026-07-21" }));
  assert.deepEqual(r2.lowest_leisure_day, r1.lowest_leisure_day);

  const dayLower = makeDay({ d: "2026-07-22", t: 4000, l: 600 }); // lower, should replace
  const { updated: r3 } = evaluateRecords(r2, makeCtx({ day: dayLower, dayKey: "2026-07-22" }));
  assert.deepEqual(r3.lowest_leisure_day, { value: 600, date: "2026-07-22", meta: null });
});

test("evaluateRecords: longest_rule_run is a state-scope record that stores the leading domain in meta", () => {
  const ctx = makeCtx({
    streaks: { rules: { "youtube.com": { current: 22 }, "reddit.com": { current: 9 } } },
    dayKey: "2026-07-01",
  });
  const { updated } = evaluateRecords({}, ctx);
  assert.deepEqual(updated.longest_rule_run, { value: 22, date: "2026-07-01", meta: { domain: "youtube.com" } });
});

test("evaluateRecords: longest_streak is a state-scope record that reads streaks.discipline directly", () => {
  const ctx = makeCtx({ streaks: { discipline: { current: 14 } }, dayKey: "2026-07-14" });
  const { updated } = evaluateRecords({}, ctx);
  assert.deepEqual(updated.longest_streak, { value: 14, date: "2026-07-14", meta: null });
});

test("evaluateRecords: week-scope record only evaluates when a week is present, and respects its qualifier", () => {
  const noWeekCtx = makeCtx({ dayKey: "2026-07-05" });
  const { updated: r1 } = evaluateRecords({}, noWeekCtx);
  assert.equal(r1.best_week_focus, undefined);

  const underQualifiedWeek = { w: "2026-W27", held: 3, recorded: 3, f: 95 }; // recorded < 4
  const { updated: r2 } = evaluateRecords({}, { ...noWeekCtx, week: underQualifiedWeek });
  assert.equal(r2.best_week_focus, undefined);

  const qualifiedWeek = { w: "2026-W27", held: 5, recorded: 5, f: 82 };
  const { updated: r3 } = evaluateRecords({}, { ...noWeekCtx, week: qualifiedWeek });
  assert.deepEqual(r3.best_week_focus, { value: 82, date: "2026-07-05", meta: null });
});

test("evaluateRecords: month-scope most_held_month reads the settled MonthRecord", () => {
  const month = { m: "2026-07", held: 24, recorded: 29 };
  const { updated } = evaluateRecords({}, { ...makeCtx({ dayKey: "2026-07-31" }), month });
  assert.deepEqual(updated.most_held_month, { value: 24, date: "2026-07-31", meta: null });
});

test("maxRuleStreakValue/maxRuleStreakDomain: find the leading rule and its domain, defaulting to none", () => {
  assert.equal(maxRuleStreakValue({}), 0);
  assert.equal(maxRuleStreakDomain({}), null);
  const rules = { "a.com": { current: 3 }, "b.com": { current: 9 }, "c.com": { current: 5 } };
  assert.equal(maxRuleStreakValue(rules), 9);
  assert.equal(maxRuleStreakDomain(rules), "b.com");
});

test("registerRecord: pushes a new definition onto the catalogue", () => {
  const before = RECORDS.length;
  registerRecord({ id: "__test_record", label: "Test", scope: "day", direction: "max", extract: (day) => day.t });
  try {
    assert.equal(RECORDS.length, before + 1);
    const { updated } = evaluateRecords({}, makeCtx({ day: makeDay({ t: 500 }) }));
    assert.equal(updated.__test_record.value, 500);
  } finally {
    RECORDS.length = before;
  }
});
