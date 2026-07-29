// Engine tests use a hand-built progression state as the "fake store" the
// architecture doc calls for (02-ARCHITECTURE.md §8) — defaultProgressionState()
// from progression-store.js, edited per test, and a fixture `sites` map. None
// of this touches chrome.storage; youtube-classifier.js's own Node fallback
// (an in-memory snapshot when chrome.storage isn't present) is what makes
// ensureYouTubeStoresLoaded() safe to await here.

const test = require("node:test");
const assert = require("node:assert/strict");

const { defaultProgressionState } = require("../progression-store.js");
const { MAX_LEDGER_DAYS, MAX_LEDGER_WEEKS, MAX_REFUSAL_DOMAINS } = require("../progression-model.js");
const {
  buildDaySnapshot,
  gateCountersFor,
  computeWeekRollup,
  computeMonthRollup,
  seedFirstDay,
  settleDay,
  settleWeek,
  settleMonth,
  settleThroughState,
  applyEvent,
} = require("../progression-engine.js");
const {
  clearChannelStore,
  clearVideoDatabase,
  setChannelClassification,
  attributionKeyForContext,
  creditYouTubeSeconds,
  recordYouTubeVisit,
} = require("../youtube-classifier.js");

function freshEntry(overrides) {
  return {
    mode: "unconstrained",
    usedSeconds: 0,
    lastReset: "2026-07-01",
    history: [],
    createdAt: "2026-07-01",
    ...overrides,
  };
}

function state(overrides) {
  return { ...defaultProgressionState(), ...overrides };
}

// ---------- buildDaySnapshot ----------

test("buildDaySnapshot: splits totals by category, including a YouTube attribution map", async () => {
  await clearChannelStore();
  await clearVideoDatabase();
  await setChannelClassification(
    { channelId: "UC_STUDY", channelName: "Study Channel" },
    { macro: "Productivity", micro: "Study" }
  );

  const day = "2026-07-01";
  const productive = freshEntry({ lastReset: day, usedSeconds: 1800, macroCategory: "Productivity", microCategory: "Coding" });
  const leisure = freshEntry({ lastReset: day, usedSeconds: 900, macroCategory: "Leisure", microCategory: "Social Media" });

  const ytEntry = freshEntry({ lastReset: day, usedSeconds: 0 });
  const meta = { domain: "youtube.com", videoId: "vid1", channelId: "UC_STUDY", channelName: "Study Channel" };
  await recordYouTubeVisit(meta); // registers vid1 -> UC_STUDY so the resolver can find the pinned classification
  ytEntry.usedSeconds += 600;
  creditYouTubeSeconds(ytEntry, attributionKeyForContext(meta), 600, day);

  const sites = { "code.example.com": productive, "social.example.com": leisure, "youtube.com": ytEntry };

  const snapshot = buildDaySnapshot(sites, day, { gatesShown: {}, gatesPassed: {} });

  assert.equal(snapshot.trackedSeconds, 1800 + 900 + 600);
  assert.equal(snapshot.productiveSeconds, 1800 + 600, "the YouTube channel is pinned Productivity");
  assert.equal(snapshot.leisureSeconds, 900);
  assert.equal(snapshot.generalSeconds, 0);
  assert.equal(snapshot.violations, 0);
  assert.equal(snapshot.activeRules, 0, "none of these domains carry a moderation rule");
});

test("buildDaySnapshot: a limit rule exceeded past tolerance counts as a violation, at/under does not", () => {
  const day = "2026-07-01"; // Wednesday
  const overLimit = freshEntry({
    mode: "limit",
    limitMinutes: 30,
    lastReset: day,
    usedSeconds: 30 * 60 + 31, // 31s over — past the 30s tolerance
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  });
  const withinTolerance = freshEntry({
    mode: "limit",
    limitMinutes: 30,
    lastReset: day,
    usedSeconds: 30 * 60 + 30, // exactly at the tolerance boundary
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  });

  const overSnap = buildDaySnapshot({ "over.example.com": overLimit }, day, { gatesShown: {}, gatesPassed: {} });
  assert.equal(overSnap.violations, 1);
  assert.equal(overSnap.ruleDays["over.example.com"].respected, false);

  const withinSnap = buildDaySnapshot({ "within.example.com": withinTolerance }, day, {
    gatesShown: {},
    gatesPassed: {},
  });
  assert.equal(withinSnap.violations, 0, "exactly at tolerance must not violate");
  assert.equal(withinSnap.ruleDays["within.example.com"].respected, true);
});

test("buildDaySnapshot: a paused rule is exempt from violation detection entirely", () => {
  const day = "2026-07-01";
  const entry = freshEntry({
    mode: "limit",
    limitMinutes: 10,
    lastReset: day,
    usedSeconds: 5000, // wildly over, but paused
    paused: true,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  });
  const snapshot = buildDaySnapshot({ "paused.example.com": entry }, day, { gatesShown: {}, gatesPassed: {} });
  assert.equal(snapshot.violations, 0);
  assert.equal(snapshot.activeRules, 0);
  assert.equal(snapshot.ruleDays["paused.example.com"], undefined, "a paused rule is skipped, not just non-violating");
});

test("buildDaySnapshot: an off-schedule day exempts a limit rule from violation and marks it unscheduled", () => {
  const day = "2026-07-01"; // Wednesday = getDay() 3
  const entry = freshEntry({
    mode: "limit",
    limitMinutes: 10,
    lastReset: day,
    usedSeconds: 5000,
    schedule: { days: [1] }, // Mondays only
  });
  const snapshot = buildDaySnapshot({ "weekday.example.com": entry }, day, { gatesShown: {}, gatesPassed: {} });
  assert.equal(snapshot.violations, 0);
  assert.equal(snapshot.activeRules, 0);
  assert.deepEqual(snapshot.ruleDays["weekday.example.com"], { scheduled: false, respected: false });
});

test("buildDaySnapshot: a restraint/block rule violates only when a gate was actually passed that day", () => {
  const day = "2026-07-01";
  const restraint = freshEntry({ mode: "restraint", lastReset: day, schedule: { days: [0, 1, 2, 3, 4, 5, 6] } });
  const blocked = freshEntry({ mode: "block", lastReset: day, schedule: { days: [0, 1, 2, 3, 4, 5, 6] } });

  const passedSnap = buildDaySnapshot(
    { "restraint.example.com": restraint },
    day,
    { gatesShown: { "restraint.example.com": 1 }, gatesPassed: { "restraint.example.com": 1 } }
  );
  assert.equal(passedSnap.violations, 1);

  const shownOnlySnap = buildDaySnapshot(
    { "blocked.example.com": blocked },
    day,
    { gatesShown: { "blocked.example.com": 2 }, gatesPassed: {} }
  );
  assert.equal(shownOnlySnap.violations, 0, "being shown the gate and turning back is not a violation");
});

test("buildDaySnapshot: refusals are capped per domain and summed, with a per-domain breakdown for the blocked page", () => {
  const day = "2026-07-01";
  const gateCounters = {
    gatesShown: { "a.example.com": 5, "b.example.com": 1 },
    gatesPassed: { "a.example.com": 1, "b.example.com": 0 },
  };
  const snapshot = buildDaySnapshot({}, day, gateCounters);
  // a: shown 5, passed 1 -> 4 refusals, capped at REFUSAL_MAX_PER_DOMAIN_PER_DAY (3)
  // b: shown 1, passed 0 -> 1 refusal
  assert.equal(snapshot.refusalsByDomain["a.example.com"], 3);
  assert.equal(snapshot.refusalsByDomain["b.example.com"], 1);
  assert.equal(snapshot.refusals, 4);
  assert.equal(snapshot.gatesShown, 6);
  assert.equal(snapshot.gatesPassed, 1);
});

// ---------- gateCountersFor ----------

test("gateCountersFor: only returns live counters for the day currently held in state.today", () => {
  const s = state({ today: { date: "2026-07-01", gatesShown: { x: 2 }, gatesPassed: { x: 1 } } });
  assert.deepEqual(gateCountersFor(s, "2026-07-01"), { gatesShown: { x: 2 }, gatesPassed: { x: 1 } });
  assert.deepEqual(gateCountersFor(s, "2026-06-30"), { gatesShown: {}, gatesPassed: {} });
});

// ---------- settleDay ----------

test("settleDay: a clean, well within standard day is held and earns the full-condition XP", () => {
  const day = "2026-07-01";
  const entry = freshEntry({ lastReset: day, usedSeconds: 3600, macroCategory: "Productivity" });
  const sites = { "work.example.com": entry };
  const s = state({ today: { date: day, gatesShown: {}, gatesPassed: {} } });

  const next = settleDay(s, sites, day);
  const record = next.days[0];

  assert.equal(record.d, day);
  assert.equal(record.a, 0);
  assert.equal(record.h, 1);
  assert.equal(record.c1, 1);
  assert.equal(record.c2, 1);
  assert.equal(record.c3, 1);
  // adherence(25) + restraint(25) + focus(25) + held bonus(25) + streak 2*1
  assert.equal(record.xp, 102);
  assert.equal(record.st, 1);
  assert.equal(next.streaks.discipline.current, 1);
  // level.xp also includes the silent_day achievement (50 XP) this same
  // day qualifies for — record.xp deliberately stays day-XP-only (§3.2),
  // it's level.xp that folds in achievement XP too (settleDay step 10).
  assert.equal(next.level.xp, 102 + 50);
  assert.equal(next.lifetime.daysTracked, 1);
  assert.equal(next.lifetime.daysHeld, 1);
});

test("settleDay: an absent day (no tracked time, no gate events) changes nothing but the settlement cursor", () => {
  const day = "2026-07-01";
  const s = state({ today: { date: day, gatesShown: {}, gatesPassed: {} } });
  const next = settleDay(s, {}, day);
  const record = next.days[0];

  assert.equal(record.a, 1);
  assert.equal(record.h, 0);
  assert.equal(record.xp, 0);
  assert.equal(next.level.xp, 0);
  assert.equal(next.lifetime.daysTracked, 0, "an absent day must not count toward daysTracked");
  assert.equal(next.streaks.discipline.current, 0);
  assert.equal(next.settlement.lastSettledDate, day);
});

test("settleDay: does not mutate the state object it was given (pure, like advanceStreak)", () => {
  const day = "2026-07-01";
  const s = state({ today: { date: day, gatesShown: {}, gatesPassed: {} } });
  const before = JSON.stringify(s);
  settleDay(s, {}, day);
  assert.equal(JSON.stringify(s), before);
});

test("settleDay: a rule violation drops adherence XP but leaves the other conditions unaffected", () => {
  const day = "2026-07-01";
  const entry = freshEntry({
    mode: "limit",
    limitMinutes: 10,
    lastReset: day,
    usedSeconds: 20 * 60, // double the limit
    macroCategory: "Productivity",
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  });
  const s = state({ today: { date: day, gatesShown: {}, gatesPassed: {} } });
  const next = settleDay(s, { "over.example.com": entry }, day);
  const record = next.days[0];

  assert.equal(record.c1, 0, "the limit was violated");
  assert.equal(record.c2, 1);
  assert.equal(record.c3, 1);
  assert.equal(record.h, 0, "held requires all three conditions");
  // restraint(25) + focus(25) only — no adherence, no held bonus, no streak bonus
  assert.equal(record.xp, 50);
});

test("settleDay: per-rule streaks fold forward and an off-schedule day leaves them untouched", () => {
  const mon = "2026-06-29";
  const wed = "2026-07-01";
  const entry = freshEntry({
    mode: "limit",
    limitMinutes: 60,
    lastReset: mon,
    usedSeconds: 600,
    schedule: { days: [1] }, // Mondays only
  });

  let s = state({ today: { date: mon, gatesShown: {}, gatesPassed: {} } });
  s = settleDay(s, { "mon-only.example.com": entry }, mon);
  assert.equal(s.streaks.rules["mon-only.example.com"].current, 1);

  // Wednesday: entry.lastReset is stale (still "mon"), but usageSecondsForDate
  // only reads usedSeconds when lastReset === key, so an unrelated day off
  // its schedule reports 0 usage here regardless — the point of this case
  // is that the rule is off-schedule and its streak must not move either way.
  s = settleDay(s, { "mon-only.example.com": entry }, wed);
  assert.equal(s.streaks.rules["mon-only.example.com"].current, 1, "off-schedule day must not extend or break the run");
});

test("settleDay: achievements are one-shot and never re-tested once earned", () => {
  const day = "2026-07-01";
  let s = state({
    today: { date: day, gatesShown: {}, gatesPassed: {} },
    lifetime: { ...defaultProgressionState().lifetime, rulesCreated: 1 },
  });
  s = settleDay(s, {}, day);
  assert.ok(s.achievements.first_rule, "first_rule should fire once rulesCreated >= 1");
  const awardedAt = s.achievements.first_rule.at;

  // Settle a second day; rulesCreated is still >= 1, but the achievement
  // must not be re-awarded or its timestamp touched.
  const s2 = settleDay(s, {}, "2026-07-02");
  assert.equal(s2.achievements.first_rule.at, awardedAt);
  assert.equal(s2.lifetime.xpFromAchievements, s.lifetime.xpFromAchievements, "no double payout");
});

test("settleDay: personal records only update on a strictly better qualifying day", () => {
  const day1 = "2026-07-01";
  const day2 = "2026-07-02";
  const highFocus = freshEntry({ lastReset: day1, usedSeconds: 3600, macroCategory: "Productivity" });
  const lowFocus = freshEntry({ lastReset: day2, usedSeconds: 3600, macroCategory: "Leisure" });

  let s = state({ today: { date: day1, gatesShown: {}, gatesPassed: {} } });
  s = settleDay(s, { "a.example.com": highFocus }, day1);
  const firstRecord = s.records.best_focus_day;
  assert.ok(firstRecord, "a qualifying day (>= 60 min tracked) must set the record");
  assert.equal(firstRecord.value, 100);

  s = { ...s, today: { date: day2, gatesShown: {}, gatesPassed: {} } };
  s = settleDay(s, { "b.example.com": lowFocus }, day2);
  assert.equal(s.records.best_focus_day.value, 100, "a worse day must not overwrite the record");
  assert.equal(s.records.best_focus_day.date, day1);
});

// ---------- settleWeek / settleMonth ----------

test("computeWeekRollup / computeMonthRollup: excludes absent days from `recorded` but includes them in totals", () => {
  const days = [
    { d: "2026-06-29", a: 1, h: 0, t: 0, p: 0, l: 0, f: 100, xp: 0, r: 0 },
    { d: "2026-06-30", a: 0, h: 1, t: 3600, p: 3600, l: 0, f: 90, xp: 100, r: 0 },
    { d: "2026-07-01", a: 0, h: 1, t: 1800, p: 1800, l: 0, f: 80, xp: 90, r: 1 },
  ];
  const week = computeWeekRollup(days, "2026-W27");
  assert.equal(week.held, 2);
  assert.equal(week.recorded, 2);
  assert.equal(week.t, 5400);
  assert.equal(week.f, 85, "mean focus over non-absent days only");

  const juneMonth = computeMonthRollup(days, "2026-06");
  assert.equal(juneMonth.held, 1);
  assert.equal(juneMonth.recorded, 1);
  const julyMonth = computeMonthRollup(days, "2026-07");
  assert.equal(julyMonth.held, 1);
  assert.equal(julyMonth.xp, 90);
  assert.equal(julyMonth.refusals, 1);
});

test("settleWeek: awards the correct XP tier and is a no-op the second time for the same week", () => {
  let s = state();
  s.days = [
    { d: "2026-06-29", a: 0, h: 1, t: 3600, p: 3600, l: 0, f: 90, xp: 100, r: 0 },
    { d: "2026-06-30", a: 0, h: 1, t: 3600, p: 3600, l: 0, f: 90, xp: 100, r: 0 },
    { d: "2026-07-01", a: 0, h: 1, t: 3600, p: 3600, l: 0, f: 90, xp: 100, r: 0 },
    { d: "2026-07-02", a: 0, h: 1, t: 3600, p: 3600, l: 0, f: 90, xp: 100, r: 0 },
    { d: "2026-07-03", a: 0, h: 1, t: 3600, p: 3600, l: 0, f: 90, xp: 100, r: 0 },
  ];
  const before = s.level.xp;
  const settled = settleWeek(s, "2026-W27", "2026-07-05");
  assert.equal(settled.weeks[0].tier, 5);
  assert.equal(settled.weeks[0].xp, 75);
  assert.equal(settled.level.xp, before + 75);
  assert.equal(settled.settlement.lastWeekSettled, "2026-W27");

  const settledAgain = settleWeek(settled, "2026-W27", "2026-07-05");
  assert.equal(settledAgain, settled, "already-settled week must be a pure no-op");
});

test("settleMonth: rolls up the month's own days only and awards no XP", () => {
  let s = state();
  s.days = [
    { d: "2026-06-30", a: 0, h: 1, t: 3600, p: 3600, l: 0, f: 90, xp: 100, r: 0 },
    { d: "2026-07-01", a: 0, h: 0, t: 1800, p: 0, l: 1800, f: 20, xp: 0, r: 0 },
  ];
  const settled = settleMonth(s, "2026-07", "2026-07-01");
  assert.equal(settled.months[0].m, "2026-07");
  assert.equal(settled.months[0].held, 0);
  assert.equal(settled.months[0].t, 1800, "June's day must not leak into July's rollup");
  assert.equal(settled.level.xp, s.level.xp, "month settlement never awards XP");

  const again = settleMonth(settled, "2026-07", "2026-07-01");
  assert.equal(again, settled, "already-settled month must be a pure no-op");
});

// ---------- settleThroughState ----------

test("settleThroughState: cold start seeds firstDay from the earliest date in `sites`, clamped to 7 days back", async () => {
  const today = "2026-07-20";
  const sites = { "old.example.com": freshEntry({ createdAt: "2026-05-01", lastReset: "2026-07-19" }) };
  const next = await settleThroughState(state(), sites, today);
  assert.equal(next.lifetime.firstDay, "2026-07-13", "clamped to 7 days before today, not the true 2026-05-01 origin");
});

test("settleThroughState: cold start with no site history at all seeds from today (nothing to back-fill)", async () => {
  const today = "2026-07-20";
  const next = await settleThroughState(state(), {}, today);
  assert.equal(next.lifetime.firstDay, today);
  assert.equal(next.days.length, 0, "the loop condition is cursor < todayKey, so nothing settles yet");
});

test("settleThroughState: running twice with nothing new to settle is byte-identical", async () => {
  const sites = { "work.example.com": freshEntry({ lastReset: "2026-07-04", usedSeconds: 1200, macroCategory: "Productivity" }) };
  const s = state({ today: { date: "2026-07-05", gatesShown: {}, gatesPassed: {} } });
  const first = await settleThroughState(s, sites, "2026-07-05");
  const second = await settleThroughState(first, sites, "2026-07-05");
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test("settleThroughState: a multi-day gap settles absent days without breaking an existing streak", async () => {
  const sites = { "work.example.com": freshEntry({ lastReset: "2026-06-29", usedSeconds: 3600, macroCategory: "Productivity" }) };
  let s = state({ today: { date: "2026-06-30", gatesShown: {}, gatesPassed: {} } });
  s = await settleThroughState(s, sites, "2026-06-30"); // settles 06-29, streak = 1

  assert.equal(s.streaks.discipline.current, 1);

  // The browser stays closed for 5 days; sites is untouched (still shows
  // 06-29's usage under a stale lastReset, so every subsequent day reads 0).
  s = await settleThroughState(s, sites, "2026-07-05");
  const settledDates = s.days.map((d) => d.d);
  assert.deepEqual(settledDates, ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]);
  const gapDays = s.days.slice(1);
  assert.ok(gapDays.every((d) => d.a === 1), "every day in the gap must be absent");
  assert.equal(s.streaks.discipline.current, 1, "absence pauses the streak, it does not reset it (T6)");
});

test("settleThroughState: resets `today` counters once the calendar day advances", async () => {
  const s = state({ today: { date: "2026-06-29", gatesShown: { x: 3 }, gatesPassed: { x: 1 } } });
  const next = await settleThroughState(s, {}, "2026-06-30");
  assert.deepEqual(next.today, { date: "2026-06-30", gatesShown: {}, gatesPassed: {} });
});

test("settleThroughState: prunes days beyond MAX_LEDGER_DAYS, keeping the newest and dropping the oldest", async () => {
  const days = [];
  for (let i = 0; i < MAX_LEDGER_DAYS + 10; i++) {
    days.push({ d: `day-${i}`, t: 0, h: 0, a: 1, xp: 0, st: 0 });
  }
  const s = state({
    settlement: { lastSettledDate: "2026-07-19", lastRunAt: null, lastWeekSettled: null },
    today: { date: "2026-07-20", gatesShown: {}, gatesPassed: {} },
    days,
  });
  const next = await settleThroughState(s, {}, "2026-07-20");
  assert.equal(next.days.length, MAX_LEDGER_DAYS);
  assert.equal(next.days[0].d, `day-10`, "the oldest 10 entries must be dropped, not the newest");
  assert.equal(next.days[next.days.length - 1].d, `day-${MAX_LEDGER_DAYS + 9}`);
});

test("settleThroughState: prunes weeks beyond MAX_LEDGER_WEEKS, keeping the newest", async () => {
  const weeks = [];
  for (let i = 0; i < MAX_LEDGER_WEEKS + 5; i++) {
    weeks.push({ w: `week-${i}`, held: 0, recorded: 0, xp: 0, tier: 0 });
  }
  const s = state({
    settlement: { lastSettledDate: "2026-07-19", lastRunAt: null, lastWeekSettled: null },
    today: { date: "2026-07-20", gatesShown: {}, gatesPassed: {} },
    weeks,
  });
  const next = await settleThroughState(s, {}, "2026-07-20");
  assert.equal(next.weeks.length, MAX_LEDGER_WEEKS);
  assert.equal(next.weeks[0].w, `week-5`);
});

test("settleThroughState: prunes lifetime.refusalsByDomain to the MAX_REFUSAL_DOMAINS most-refused domains", async () => {
  const refusalsByDomain = {};
  for (let i = 0; i < MAX_REFUSAL_DOMAINS + 3; i++) {
    refusalsByDomain[`site-${i}.example.com`] = i + 1; // higher index = more refusals
  }
  const s = state({
    settlement: { lastSettledDate: "2026-07-19", lastRunAt: null, lastWeekSettled: null },
    today: { date: "2026-07-20", gatesShown: {}, gatesPassed: {} },
    lifetime: { ...defaultProgressionState().lifetime, refusalsByDomain },
  });
  const next = await settleThroughState(s, {}, "2026-07-20");
  const kept = Object.keys(next.lifetime.refusalsByDomain);
  assert.equal(kept.length, MAX_REFUSAL_DOMAINS);
  // The three least-refused domains (site-0, site-1, site-2) must be dropped.
  assert.ok(!("site-0.example.com" in next.lifetime.refusalsByDomain));
  assert.ok(!("site-1.example.com" in next.lifetime.refusalsByDomain));
  assert.ok(!("site-2.example.com" in next.lifetime.refusalsByDomain));
  assert.equal(next.lifetime.refusalsByDomain[`site-${MAX_REFUSAL_DOMAINS + 2}.example.com`], MAX_REFUSAL_DOMAINS + 3);
});

test("settleThroughState: leaves lifetime.refusalsByDomain untouched when at or under the cap", async () => {
  const refusalsByDomain = { "a.example.com": 3, "b.example.com": 1 };
  const s = state({
    settlement: { lastSettledDate: "2026-07-19", lastRunAt: null, lastWeekSettled: null },
    today: { date: "2026-07-20", gatesShown: {}, gatesPassed: {} },
    lifetime: { ...defaultProgressionState().lifetime, refusalsByDomain },
  });
  const next = await settleThroughState(s, {}, "2026-07-20");
  assert.deepEqual(next.lifetime.refusalsByDomain, refusalsByDomain);
});

test("seedFirstDay: pulls the earliest date from createdAt, lastReset and history[].date alike", () => {
  const today = "2026-07-20";
  const sites = {
    a: { createdAt: "2026-07-18", lastReset: "2026-07-19", history: [] },
    b: { createdAt: "2026-07-19", lastReset: "2026-07-19", history: [{ date: "2026-07-16" }] },
  };
  assert.equal(seedFirstDay(sites, today), "2026-07-16");
});

// ---------- applyEvent ----------

test("applyEvent: gate_shown/gate_passed increment today's per-domain counters", () => {
  const s = state({ today: { date: "2026-07-01", gatesShown: {}, gatesPassed: {} } });
  let next = applyEvent(s, "gate_shown", { domain: "x.example.com" }, "2026-07-01");
  next = applyEvent(next, "gate_shown", { domain: "x.example.com" }, "2026-07-01");
  next = applyEvent(next, "gate_passed", { domain: "x.example.com" }, "2026-07-01");
  assert.equal(next.today.gatesShown["x.example.com"], 2);
  assert.equal(next.today.gatesPassed["x.example.com"], 1);
});

test("applyEvent: rolls `today` to the new date before crediting, so a post-midnight event lands correctly", () => {
  const s = state({ today: { date: "2026-06-30", gatesShown: { stale: 9 }, gatesPassed: {} } });
  const next = applyEvent(s, "gate_shown", { domain: "fresh.example.com" }, "2026-07-01");
  assert.deepEqual(next.today.gatesShown, { "fresh.example.com": 1 }, "yesterday's counters must not leak in");
  assert.equal(next.today.date, "2026-07-01");
});

test("applyEvent: rule_created/rule_loosened increment lifetime counters; rule_deleted drops the rule streak", () => {
  const s = state({ today: { date: "2026-07-01", gatesShown: {}, gatesPassed: {} } });
  let next = applyEvent(s, "rule_created", {}, "2026-07-01");
  next = applyEvent(next, "rule_loosened", {}, "2026-07-01");
  assert.equal(next.lifetime.rulesCreated, 1);
  assert.equal(next.lifetime.rulesLoosened, 1);

  next.streaks.rules["gone.example.com"] = { current: 5, best: 5, lastDate: "2026-07-01" };
  next = applyEvent(next, "rule_deleted", { domain: "gone.example.com" }, "2026-07-01");
  assert.equal(next.streaks.rules["gone.example.com"], undefined);
});

test("applyEvent: does not mutate the state object it was given", () => {
  const s = state({ today: { date: "2026-07-01", gatesShown: {}, gatesPassed: {} } });
  const before = JSON.stringify(s);
  applyEvent(s, "gate_shown", { domain: "x.example.com" }, "2026-07-01");
  assert.equal(JSON.stringify(s), before);
});

test("applyEvent: level_up_seen flips the existing lastLevelUp flag and never touches level/xp (T2)", () => {
  const s = state({
    today: { date: "2026-07-01", gatesShown: {}, gatesPassed: {} },
    level: { xp: 500, level: 5, rankId: "observer", lastLevelUp: { level: 5, at: "2026-06-30", seen: false } },
  });
  const next = applyEvent(s, "level_up_seen", {}, "2026-07-01");
  assert.equal(next.level.lastLevelUp.seen, true);
  assert.equal(next.level.xp, 500);
  assert.equal(next.level.level, 5);
});

test("applyEvent: level_up_seen is a no-op when there is no pending level-up to dismiss", () => {
  const s = state({ today: { date: "2026-07-01", gatesShown: {}, gatesPassed: {} }, level: { xp: 0, level: 1, rankId: "observer", lastLevelUp: null } });
  const next = applyEvent(s, "level_up_seen", {}, "2026-07-01");
  assert.equal(next.level.lastLevelUp, null);
});

test("applyEvent: config_updated writes clamped fields into state.config and leaves unspecified ones alone", () => {
  const s = state({ today: { date: "2026-07-01", gatesShown: {}, gatesPassed: {} } });
  const next = applyEvent(s, "config_updated", { leisureCeilingMinutes: 90 }, "2026-07-01");
  assert.equal(next.config.leisureCeilingMinutes, 90);
  assert.equal(next.config.focusTarget, s.config.focusTarget, "focusTarget was not part of the payload and must be untouched");

  const next2 = applyEvent(next, "config_updated", { focusTarget: 75 }, "2026-07-01");
  assert.equal(next2.config.leisureCeilingMinutes, 90, "the previous update must not be reverted");
  assert.equal(next2.config.focusTarget, 75);
});

test("applyEvent: config_updated ignores non-numeric or missing fields rather than corrupting config", () => {
  const s = state({ today: { date: "2026-07-01", gatesShown: {}, gatesPassed: {} } });
  const before = JSON.stringify(s.config);
  const next = applyEvent(s, "config_updated", { leisureCeilingMinutes: "90", focusTarget: null }, "2026-07-01");
  assert.equal(JSON.stringify(next.config), before);
});
