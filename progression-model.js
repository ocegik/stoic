// ---------- progression-model.js ----------
// Pure arithmetic for the progression system: the level curve, the Daily
// Standard, streak transitions, the XP registry, the achievement catalogue
// and the personal-record comparators. No chrome.*, no storage, no `sites` —
// every function here takes plain data and returns plain data, exactly like
// background-logic.js does for tick(). This is the only progression file
// with non-trivial arithmetic, and the only one that needs exhaustive tests.
//
// Loaded the same two ways as every other classic script in this codebase:
//   - background.js pulls it in with importScripts(...), after common.js.
//   - popup.html / options.html / blocked.html load it with a <script> tag,
//     after common.js.
//   - test/progression-model.test.js require()s it directly under Node.

// dateKey/addDays/dateFromKey live in common.js. In the browser or worker
// they're already globals by the time this file loads (common.js runs
// first); under Node, pull them in via require the same way
// background-logic.js does for todayStr.
const { dateKey, addDays, dateFromKey } =
  typeof module !== "undefined" && module.exports ? require("./common.js") : self;

// ---------- 1.1 constants (exact values — do not tune) ----------

const PROGRESSION_SCHEMA_VERSION = 1;

// XP economy
const XP_CONDITION_ADHERENCE = 25;
const XP_CONDITION_RESTRAINT = 25;
const XP_CONDITION_FOCUS = 25;
const XP_DAY_HELD_BONUS = 25;
const XP_STREAK_PER_DAY = 2;
const XP_STREAK_CAP = 50;
const XP_REFUSAL = 10;
const REFUSAL_MAX_PER_DOMAIN_PER_DAY = 3;
const XP_REFUSAL_DAILY_CAP = 30;
const WEEK_XP_TIERS = { 5: 75, 6: 110, 7: 150 };

// Level curve: cost(L -> L+1) = LEVEL_BASE_COST + LEVEL_COST_STEP * (L - 1)
const LEVEL_BASE_COST = 100;
const LEVEL_COST_STEP = 60;

// Day conditions
const DEFAULT_LEISURE_CEILING_MINUTES = 60; // user range 15..240
const DEFAULT_FOCUS_TARGET = 60; // user range 40..90
const MIN_TRACKED_MINUTES_FOR_FOCUS = 30; // below this, C3 is waived
const VIOLATION_TOLERANCE_SECONDS = 30; // absorbs tick granularity

// Retention
const MAX_LEDGER_DAYS = 400;
const MAX_LEDGER_WEEKS = 120;
const MAX_CATCHUP_DAYS = 400;

const RANKS = [
  { id: "observer", name: "Observer", minLevel: 1, descriptor: "You are watching your own behaviour." },
  { id: "deliberate", name: "Deliberate", minLevel: 6, descriptor: "Fewer decisions are being made for you." },
  { id: "measured", name: "Measured", minLevel: 11, descriptor: "You know what a good day costs." },
  { id: "consistent", name: "Consistent", minLevel: 16, descriptor: "Good days have stopped being unusual." },
  { id: "disciplined", name: "Disciplined", minLevel: 21, descriptor: "The standard holds without negotiation." },
  { id: "tempered", name: "Tempered", minLevel: 26, descriptor: "Restraint is no longer effortful." },
  { id: "composed", name: "Composed", minLevel: 31, descriptor: "The impulse arrives and nothing follows it." },
  { id: "self_governed", name: "Self-Governed", minLevel: 36, descriptor: "You set the terms." },
];

// ---------- 1.2 level curve ----------
// cost(L -> L+1) = LEVEL_BASE_COST + LEVEL_COST_STEP*(L-1)
// cumulative(L)  = LEVEL_BASE_COST*(L-1) + (LEVEL_COST_STEP/2)*(L-1)*(L-2)
// Derived from the constants above rather than hard-coded, so the two can
// never drift apart.

function cumulativeXpForLevel(level) {
  const n = level - 1;
  return LEVEL_BASE_COST * n + (LEVEL_COST_STEP / 2) * n * (n - 1);
}

// Inverse of cumulativeXpForLevel. Solves the quadratic for a first guess,
// then walks by ±1 to correct for float error — cheap, since levels are
// small, and it guarantees the true invariant
// cumulativeXpForLevel(level) <= xp < cumulativeXpForLevel(level + 1).
function levelForXp(xp) {
  const a = LEVEL_COST_STEP / 2;
  const b = LEVEL_BASE_COST - LEVEL_COST_STEP / 2;
  const c = -xp;
  const n = a === 0 ? -c / b : (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  let level = Math.max(1, Math.floor(n) + 1);
  while (cumulativeXpForLevel(level + 1) <= xp) level++;
  while (level > 1 && cumulativeXpForLevel(level) > xp) level--;
  return level;
}

function rankForLevel(level) {
  let match = RANKS[0];
  for (const rank of RANKS) {
    if (level >= rank.minLevel) match = rank;
    else break;
  }
  return match;
}

function xpProgressForLevel(xp) {
  const level = levelForXp(xp);
  const rank = rankForLevel(level);
  const base = cumulativeXpForLevel(level);
  const next = cumulativeXpForLevel(level + 1);
  const xpIntoLevel = xp - base;
  const xpForNextLevel = next - base;
  const pct = xpForNextLevel > 0 ? Math.min(100, Math.max(0, (xpIntoLevel / xpForNextLevel) * 100)) : 100;
  return { level, rank, xpIntoLevel, xpForNextLevel, pct };
}

// ---------- 1.3 date/period helpers ----------

function asDate(dateOrKey) {
  return typeof dateOrKey === "string" ? dateFromKey(dateOrKey) : dateOrKey;
}

// ISO-8601 week key ("2026-W31"), Monday-start, correct across year
// boundaries (Jan 1 can fall in W52/W53 of the prior year and vice versa).
// Standard "nearest Thursday" algorithm, done in UTC space using the plain
// Y/M/D numbers pulled off the local date first, so local timezone/DST never
// perturbs the week math.
function isoWeekKey(dateOrKey) {
  const date = asDate(dateOrKey);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(dateOrKey) {
  const date = asDate(dateOrKey);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function isWeekEnd(dateOrKey) {
  return asDate(dateOrKey).getDay() === 0; // Sunday
}

function isMonthEnd(dateOrKey) {
  const date = asDate(dateOrKey);
  return addDays(date, 1).getMonth() !== date.getMonth();
}

function lastNDays(days, n) {
  return (days || []).slice(-n);
}

// Length of the run of `predicate(day) === true` ending at the newest entry
// (the array tail). Stops at the first entry that fails the predicate.
function consecutiveFrom(days, predicate) {
  const list = days || [];
  let count = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (!predicate(list[i])) break;
    count++;
  }
  return count;
}

// ---------- 1.4 day conditions ----------
//
// snapshot: { dayKey, trackedSeconds, productiveSeconds, generalSeconds,
//             leisureSeconds, focusScore, violations, gatesShown, gatesPassed,
//             refusals, activeRules }
// config:   { leisureCeilingMinutes, focusTarget, minTrackedMinutesForFocus }
//
// An absent day reports every condition as false (including held) rather
// than whatever c1/c2/c3 would trivially evaluate to (e.g. zero leisure
// trivially satisfies C2) — the streak logic keys on `absent` first, so an
// absent day is never treated as a break regardless of what these booleans
// say.
function evaluateConditions(snapshot, config) {
  const absent = snapshot.trackedSeconds === 0 && snapshot.gatesShown === 0;
  if (absent) {
    return { absent: true, c1: false, c2: false, c3: false, focusWaived: false, held: false };
  }
  const c1 = snapshot.violations === 0;
  const c2 = snapshot.leisureSeconds <= config.leisureCeilingMinutes * 60;
  const focusWaived = snapshot.trackedSeconds < config.minTrackedMinutesForFocus * 60;
  const c3 = focusWaived || snapshot.focusScore >= config.focusTarget;
  const held = c1 && c2 && c3;
  return { absent: false, c1, c2, c3, focusWaived, held };
}

// ---------- 1.5 streak transitions ----------
// Pure — returns a new streak object, never mutates the one passed in.

function advanceStreak(streak, { held, absent }, dayKey) {
  const s = streak || { current: 0, currentStart: null, best: 0, bestStart: null, bestEnd: null, lastHeldDate: null, lastBrokenFrom: 0 };

  if (absent) {
    return { ...s };
  }

  if (held) {
    const wasZero = !s.current;
    const current = (s.current || 0) + 1;
    const currentStart = wasZero ? dayKey : s.currentStart;
    let best = s.best || 0;
    let bestStart = s.bestStart || null;
    let bestEnd = s.bestEnd || null;
    if (current > best) {
      best = current;
      bestStart = currentStart;
      bestEnd = dayKey;
    }
    return {
      current,
      currentStart,
      best,
      bestStart,
      bestEnd,
      lastHeldDate: dayKey,
      lastBrokenFrom: s.lastBrokenFrom || 0,
    };
  }

  // Not held, not absent.
  if (s.current > 0) {
    return {
      current: 0,
      currentStart: null,
      best: s.best || 0,
      bestStart: s.bestStart || null,
      bestEnd: s.bestEnd || null,
      lastHeldDate: s.lastHeldDate || null,
      lastBrokenFrom: s.current,
    };
  }
  return { ...s };
}

// Same shape for a single rule's streak. `scheduled === false` leaves the
// streak untouched — off-schedule days neither extend nor break a run,
// preserving the behaviour of the superseded limitStreakDays.
function advanceRuleStreak(ruleStreak, { respected, scheduled }, dayKey) {
  const s = ruleStreak || { current: 0, best: 0, lastDate: null };
  if (!scheduled) return { ...s };
  if (respected) {
    const current = (s.current || 0) + 1;
    const best = Math.max(s.best || 0, current);
    return { current, best, lastDate: dayKey };
  }
  return { current: 0, best: s.best || 0, lastDate: s.lastDate || null };
}

// ---------- 1.6 XP rules registry ----------

const DAY_XP_RULES = [
  { id: "adherence", label: "No rule broken", compute: (ctx) => (ctx.conditions.c1 ? XP_CONDITION_ADHERENCE : 0) },
  { id: "restraint", label: "Leisure under ceiling", compute: (ctx) => (ctx.conditions.c2 ? XP_CONDITION_RESTRAINT : 0) },
  { id: "focus", label: "Focus target met", compute: (ctx) => (ctx.conditions.c3 ? XP_CONDITION_FOCUS : 0) },
  { id: "held", label: "Standard held", compute: (ctx) => (ctx.conditions.held ? XP_DAY_HELD_BONUS : 0) },
  {
    id: "streak",
    label: "Streak bonus",
    compute: (ctx) => (ctx.conditions.held ? Math.min(XP_STREAK_CAP, XP_STREAK_PER_DAY * ctx.streakAfter) : 0),
  },
  {
    id: "refusals",
    label: "Turned back",
    compute: (ctx) => Math.min(XP_REFUSAL_DAILY_CAP, XP_REFUSAL * ctx.snapshot.refusals),
  },
];

function registerDayXpRule(rule) {
  DAY_XP_RULES.push(rule);
}

// ctx: { snapshot, conditions, streakAfter }
function computeDayXp(ctx) {
  if (ctx.conditions.absent) return { total: 0, breakdown: [] };
  const breakdown = [];
  let total = 0;
  for (const rule of DAY_XP_RULES) {
    const xp = rule.compute(ctx);
    if (xp > 0) breakdown.push({ id: rule.id, label: rule.label, xp });
    total += xp;
  }
  return { total, breakdown };
}

// Highest tier reached wins; tiers replace each other, they do not stack.
function computeWeekXp(heldDays) {
  const tiers = Object.keys(WEEK_XP_TIERS)
    .map(Number)
    .sort((a, b) => b - a);
  for (const tier of tiers) {
    if (heldDays >= tier) return { xp: WEEK_XP_TIERS[tier], tier };
  }
  return { xp: 0, tier: 0 };
}

// ---------- shared achievement/record helper ----------
// Longest currently-running per-rule streak across every tracked rule, used
// by unbroken_30/ironclad_100 and the longest_rule_run record.
function maxRuleStreakValue(rules) {
  let best = 0;
  for (const r of Object.values(rules || {})) {
    if ((r.current || 0) > best) best = r.current;
  }
  return best;
}

function maxRuleStreakDomain(rules) {
  let best = 0;
  let domain = null;
  for (const [d, r] of Object.entries(rules || {})) {
    if ((r.current || 0) > best) {
      best = r.current;
      domain = d;
    }
  }
  return domain;
}

// ---------- 1.7 achievements ----------
// ctx: { state, day, days, weeks, months, streaks, lifetime, config }, where
// `day` is the DayRecord just settled and days/weeks/months include it.
// `progress` is optional — it powers the progress bar shown on locked
// achievements (T4); achievements without a natural single-number progress
// (same-day conditions, multi-week trends, conditional recoveries) omit it.

const ACHIEVEMENTS = [
  {
    id: "first_rule",
    name: "First Line Drawn",
    kind: "origin",
    xp: 25,
    criterion: "Create your first moderation rule.",
    progress: (ctx) => ({ current: Math.min(ctx.lifetime.rulesCreated, 1), target: 1 }),
    test: (ctx) => ctx.lifetime.rulesCreated >= 1,
  },
  {
    id: "first_week",
    name: "Seven Days Observed",
    kind: "origin",
    xp: 25,
    criterion: "Have 7 days recorded in the ledger.",
    progress: (ctx) => ({ current: ctx.lifetime.daysTracked, target: 7 }),
    test: (ctx) => ctx.lifetime.daysTracked >= 7,
  },
  {
    id: "clean_week",
    name: "Clean Week",
    kind: "streak",
    xp: 50,
    criterion: "Reach a 7-day discipline streak.",
    progress: (ctx) => ({ current: ctx.streaks.discipline.current, target: 7 }),
    test: (ctx) => ctx.streaks.discipline.current >= 7,
  },
  {
    id: "clean_fortnight",
    name: "Clean Fortnight",
    kind: "streak",
    xp: 100,
    criterion: "Reach a 14-day discipline streak.",
    progress: (ctx) => ({ current: ctx.streaks.discipline.current, target: 14 }),
    test: (ctx) => ctx.streaks.discipline.current >= 14,
  },
  {
    id: "clean_month",
    name: "Clean Month",
    kind: "streak",
    xp: 200,
    criterion: "Reach a 30-day discipline streak.",
    progress: (ctx) => ({ current: ctx.streaks.discipline.current, target: 30 }),
    test: (ctx) => ctx.streaks.discipline.current >= 30,
  },
  {
    id: "clean_quarter",
    name: "Clean Quarter",
    kind: "streak",
    xp: 400,
    criterion: "Reach a 90-day discipline streak.",
    progress: (ctx) => ({ current: ctx.streaks.discipline.current, target: 90 }),
    test: (ctx) => ctx.streaks.discipline.current >= 90,
  },
  {
    id: "clean_year",
    name: "Clean Year",
    kind: "streak",
    xp: 400,
    criterion: "Reach a 365-day discipline streak.",
    progress: (ctx) => ({ current: ctx.streaks.discipline.current, target: 365 }),
    test: (ctx) => ctx.streaks.discipline.current >= 365,
  },
  {
    id: "first_refusal",
    name: "Turned Back",
    kind: "refusal",
    xp: 25,
    criterion: "Record your first refusal.",
    progress: (ctx) => ({ current: Math.min(ctx.lifetime.refusals, 1), target: 1 }),
    test: (ctx) => ctx.lifetime.refusals >= 1,
  },
  {
    id: "refusals_10",
    name: "Ten Refusals",
    kind: "refusal",
    xp: 50,
    criterion: "Reach 10 lifetime refusals.",
    progress: (ctx) => ({ current: ctx.lifetime.refusals, target: 10 }),
    test: (ctx) => ctx.lifetime.refusals >= 10,
  },
  {
    id: "refusals_50",
    name: "Fifty Refusals",
    kind: "refusal",
    xp: 100,
    criterion: "Reach 50 lifetime refusals.",
    progress: (ctx) => ({ current: ctx.lifetime.refusals, target: 50 }),
    test: (ctx) => ctx.lifetime.refusals >= 50,
  },
  {
    id: "refusals_250",
    name: "Two Hundred and Fifty",
    kind: "refusal",
    xp: 200,
    criterion: "Reach 250 lifetime refusals.",
    progress: (ctx) => ({ current: ctx.lifetime.refusals, target: 250 }),
    test: (ctx) => ctx.lifetime.refusals >= 250,
  },
  {
    id: "silent_day",
    name: "Silent Day",
    kind: "restraint",
    xp: 50,
    criterion: "Have a tracked day with zero leisure time.",
    test: (ctx) => ctx.day.a === 0 && ctx.day.t > 0 && ctx.day.l === 0,
  },
  {
    id: "quiet_week",
    name: "Quiet Week",
    kind: "restraint",
    xp: 100,
    criterion: "Hold leisure under 30 minutes for 7 consecutive days.",
    progress: (ctx) => ({ current: consecutiveFrom(ctx.days, (d) => d.a === 0 && d.l <= 30 * 60), target: 7 }),
    test: (ctx) => consecutiveFrom(ctx.days, (d) => d.a === 0 && d.l <= 30 * 60) >= 7,
  },
  {
    id: "silent_week",
    name: "Silent Week",
    kind: "restraint",
    xp: 400,
    criterion: "Hold zero leisure time for 7 consecutive days.",
    progress: (ctx) => ({ current: consecutiveFrom(ctx.days, (d) => d.a === 0 && d.l === 0), target: 7 }),
    test: (ctx) => consecutiveFrom(ctx.days, (d) => d.a === 0 && d.l === 0) >= 7,
  },
  {
    id: "deep_day",
    name: "Deep Day",
    kind: "focus",
    xp: 50,
    criterion: "Score a focus of 90+ on a day with at least 2 hours tracked.",
    test: (ctx) => ctx.day.f >= 90 && ctx.day.t >= 7200,
  },
  {
    id: "deep_week",
    name: "Deep Week",
    kind: "focus",
    xp: 100,
    criterion: "Average a focus score of 80+ over the last 7 days, with at least 5 tracked.",
    test: (ctx) => {
      const week = lastNDays(ctx.days, 7);
      const tracked = week.filter((d) => d.a === 0);
      if (tracked.length < 5) return false;
      const mean = tracked.reduce((sum, d) => sum + d.f, 0) / tracked.length;
      return mean >= 80;
    },
  },
  {
    id: "unbroken_30",
    name: "Unbroken",
    kind: "rule",
    xp: 100,
    criterion: "Hold a single rule for 30 consecutive scheduled days.",
    progress: (ctx) => ({ current: maxRuleStreakValue(ctx.streaks.rules), target: 30 }),
    test: (ctx) => maxRuleStreakValue(ctx.streaks.rules) >= 30,
  },
  {
    id: "ironclad_100",
    name: "Ironclad",
    kind: "rule",
    xp: 200,
    criterion: "Hold a single rule for 100 consecutive scheduled days.",
    progress: (ctx) => ({ current: maxRuleStreakValue(ctx.streaks.rules), target: 100 }),
    test: (ctx) => maxRuleStreakValue(ctx.streaks.rules) >= 100,
  },
  {
    id: "days_30",
    name: "Thirty Days",
    kind: "milestone",
    xp: 50,
    criterion: "Track 30 days.",
    progress: (ctx) => ({ current: ctx.lifetime.daysTracked, target: 30 }),
    test: (ctx) => ctx.lifetime.daysTracked >= 30,
  },
  {
    id: "days_100",
    name: "One Hundred Days",
    kind: "milestone",
    xp: 100,
    criterion: "Track 100 days.",
    progress: (ctx) => ({ current: ctx.lifetime.daysTracked, target: 100 }),
    test: (ctx) => ctx.lifetime.daysTracked >= 100,
  },
  {
    id: "days_365",
    name: "One Year",
    kind: "milestone",
    xp: 200,
    criterion: "Track 365 days.",
    progress: (ctx) => ({ current: ctx.lifetime.daysTracked, target: 365 }),
    test: (ctx) => ctx.lifetime.daysTracked >= 365,
  },
  {
    id: "days_1000",
    name: "One Thousand Days",
    kind: "milestone",
    xp: 400,
    criterion: "Track 1000 days.",
    progress: (ctx) => ({ current: ctx.lifetime.daysTracked, target: 1000 }),
    test: (ctx) => ctx.lifetime.daysTracked >= 1000,
  },
  {
    id: "productive_100h",
    name: "One Hundred Hours",
    kind: "milestone",
    xp: 50,
    criterion: "Accumulate 100 hours of lifetime productive time.",
    progress: (ctx) => ({ current: ctx.lifetime.productiveSeconds, target: 100 * 3600 }),
    test: (ctx) => ctx.lifetime.productiveSeconds >= 100 * 3600,
  },
  {
    id: "productive_500h",
    name: "Five Hundred Hours",
    kind: "milestone",
    xp: 100,
    criterion: "Accumulate 500 hours of lifetime productive time.",
    progress: (ctx) => ({ current: ctx.lifetime.productiveSeconds, target: 500 * 3600 }),
    test: (ctx) => ctx.lifetime.productiveSeconds >= 500 * 3600,
  },
  {
    id: "productive_1000h",
    name: "One Thousand Hours",
    kind: "milestone",
    xp: 200,
    criterion: "Accumulate 1000 hours of lifetime productive time.",
    progress: (ctx) => ({ current: ctx.lifetime.productiveSeconds, target: 1000 * 3600 }),
    test: (ctx) => ctx.lifetime.productiveSeconds >= 1000 * 3600,
  },
  {
    id: "downward_trend",
    name: "Downward Trend",
    kind: "improvement",
    xp: 200,
    criterion: "Reduce leisure time for 4 consecutive weeks.",
    test: (ctx) => {
      const last5 = lastNDays(ctx.weeks, 5);
      if (last5.length < 5) return false;
      for (let i = 1; i < last5.length; i++) {
        if (!(last5[i].l < last5[i - 1].l)) return false;
      }
      return true;
    },
  },
  {
    id: "back_on",
    name: "Back On",
    kind: "recovery",
    xp: 100,
    criterion: "Reach a 7-day streak after previously ending one of 14 or more days.",
    test: (ctx) => ctx.streaks.discipline.current >= 7 && ctx.streaks.discipline.lastBrokenFrom >= 14,
  },
];

function registerAchievement(def) {
  ACHIEVEMENTS.push(def);
}

// ---------- 1.8 personal records ----------
// scope: "day" | "week" | "month" | "state". `extract`/`qualifies`/`meta`
// each take the record subject for that scope: the DayRecord/WeekRecord/
// MonthRecord just settled, or — for "state" — the full ctx (so a record can
// read streaks/lifetime directly).

const RECORDS = [
  {
    id: "longest_streak",
    label: "Longest discipline streak",
    scope: "state",
    direction: "max",
    extract: (ctx) => ctx.streaks.discipline.current,
  },
  {
    id: "best_focus_day",
    label: "Best focus score",
    scope: "day",
    direction: "max",
    qualifies: (day) => day.t >= 3600,
    extract: (day) => day.f,
  },
  {
    id: "most_productive_day",
    label: "Most productive time in a day",
    scope: "day",
    direction: "max",
    extract: (day) => day.p,
  },
  {
    id: "lowest_leisure_day",
    label: "Least leisure on an active day",
    scope: "day",
    direction: "min",
    qualifies: (day) => day.t >= 3600,
    extract: (day) => day.l,
  },
  {
    id: "most_refusals_day",
    label: "Most refusals in a day",
    scope: "day",
    direction: "max",
    extract: (day) => day.r,
  },
  {
    id: "longest_rule_run",
    label: "Longest single-rule run",
    scope: "state",
    direction: "max",
    extract: (ctx) => maxRuleStreakValue(ctx.streaks.rules),
    meta: (ctx) => {
      const domain = maxRuleStreakDomain(ctx.streaks.rules);
      return domain ? { domain } : null;
    },
  },
  {
    id: "best_week_focus",
    label: "Best weekly focus average",
    scope: "week",
    direction: "max",
    qualifies: (week) => week.recorded >= 4,
    extract: (week) => week.f,
  },
  {
    id: "most_held_month",
    label: "Most days held in a month",
    scope: "month",
    direction: "max",
    extract: (month) => month.held,
  },
];

function registerRecord(def) {
  RECORDS.push(def);
}

function subjectForScope(scope, ctx) {
  if (scope === "day") return ctx.day;
  if (scope === "week") return ctx.week;
  if (scope === "month") return ctx.month;
  return ctx; // "state"
}

// existing: the current `state.records` map. ctx: { day?, week?, month?,
// streaks, lifetime, dayKey, ... } — the caller only includes day/week/month
// for the scopes it is settling this call.
// direction "min" only replaces an absent record or a strictly lower value;
// `qualifies` gates the candidate, never the incumbent (an unqualified new
// day cannot un-set a record set on a previous, qualifying day).
function evaluateRecords(existing, ctx) {
  const updated = { ...existing };
  const beaten = [];
  for (const def of RECORDS) {
    const subject = subjectForScope(def.scope, ctx);
    if (!subject) continue;
    if (def.qualifies && !def.qualifies(subject)) continue;

    const value = def.extract(subject);
    const current = updated[def.id];
    const shouldSet = !current || (def.direction === "min" ? value < current.value : value > current.value);
    if (shouldSet) {
      updated[def.id] = { value, date: ctx.dayKey || null, meta: def.meta ? def.meta(subject) : null };
      beaten.push(def.id);
    }
  }
  return { updated, beaten };
}

// ---------- exports ----------

const progressionModelApi = {
  PROGRESSION_SCHEMA_VERSION,
  XP_CONDITION_ADHERENCE,
  XP_CONDITION_RESTRAINT,
  XP_CONDITION_FOCUS,
  XP_DAY_HELD_BONUS,
  XP_STREAK_PER_DAY,
  XP_STREAK_CAP,
  XP_REFUSAL,
  REFUSAL_MAX_PER_DOMAIN_PER_DAY,
  XP_REFUSAL_DAILY_CAP,
  WEEK_XP_TIERS,
  LEVEL_BASE_COST,
  LEVEL_COST_STEP,
  DEFAULT_LEISURE_CEILING_MINUTES,
  DEFAULT_FOCUS_TARGET,
  MIN_TRACKED_MINUTES_FOR_FOCUS,
  VIOLATION_TOLERANCE_SECONDS,
  MAX_LEDGER_DAYS,
  MAX_LEDGER_WEEKS,
  MAX_CATCHUP_DAYS,
  RANKS,
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
  DAY_XP_RULES,
  registerDayXpRule,
  computeDayXp,
  computeWeekXp,
  maxRuleStreakValue,
  maxRuleStreakDomain,
  ACHIEVEMENTS,
  registerAchievement,
  RECORDS,
  registerRecord,
  evaluateRecords,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = progressionModelApi;
} else {
  Object.assign(self, progressionModelApi);
}
