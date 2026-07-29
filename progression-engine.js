// ---------- progression-engine.js ----------
// Orchestration for the progression system: turns a day's worth of `sites`
// data into a settled DayRecord, folds streaks forward, evaluates
// achievements and records, and applies XP to the level curve. This is the
// only progression file that reads `sites` and calls into common.js's
// analytics — everything else here composes progression-model.js.
//
// Split into a pure core and a thin IO shell, the same reasoning
// background.js already applies to tick()/background-logic.js:
//   - settleDay / settleWeek / settleMonth / settleThroughState / applyEvent
//     take plain data (a progression state, a `sites` map, a day key) and
//     return a new state. No chrome.*, no storage. This is what
//     test/progression-engine.test.js exercises directly, with a
//     hand-built state standing in for the store and a fixture `sites` map
//     — exactly the "fake store" the architecture doc asks for, without
//     needing to mock chrome.storage.
//   - settleThrough / recordEvent are the real entry points background.js
//     calls: they load state via progression-store.js, hand it to the pure
//     core, and save the result. This is also the only place I1 (only the
//     service worker writes) has to be honored, and it's already enforced
//     one layer down, in progression-store.js's save functions.
//
// This file is worker-only per the module layout in 02-ARCHITECTURE.md —
// it is not part of the load order for popup.html/options.html/blocked.html.
//
// Loaded the same two ways as every other classic script here:
//   - background.js pulls it in with importScripts(...), last in the chain.
//   - test/progression-engine.test.js require()s it directly under Node.
//
// Wrapped in an IIFE, same reason as progression-model.js/progression-store.js:
// this file destructures a couple dozen names out of common.js/
// progression-model.js/progression-store.js, every one of which is a
// top-level lexical binding in its home file once loaded via importScripts.
// Redeclaring any of them at this file's true top level is a hard
// SyntaxError; a function scope shadows them locally instead, the same fix
// youtube-classifier.js already relies on.
(function () {

const commonApi = typeof module !== "undefined" && module.exports ? require("./common.js") : self;
const modelApi = typeof module !== "undefined" && module.exports ? require("./progression-model.js") : self;
const youtubeApi = typeof module !== "undefined" && module.exports ? require("./youtube-classifier.js") : self;
const storeApi = typeof module !== "undefined" && module.exports ? require("./progression-store.js") : self;

const {
  dateKey,
  addDays,
  dateFromKey,
  todayStr,
  usageSecondsForDate,
  entryCategorySegments,
  calculateFocusScore,
  isScheduleDay,
  limitMinutesForDate,
  getSites,
} = commonApi;

const {
  evaluateConditions,
  advanceStreak,
  advanceRuleStreak,
  computeDayXp,
  computeWeekXp,
  xpProgressForLevel,
  isoWeekKey,
  monthKey,
  isWeekEnd,
  isMonthEnd,
  evaluateRecords,
  ACHIEVEMENTS,
  VIOLATION_TOLERANCE_SECONDS,
  REFUSAL_MAX_PER_DOMAIN_PER_DAY,
  MAX_LEDGER_DAYS,
  MAX_LEDGER_WEEKS,
  MAX_CATCHUP_DAYS,
  MAX_REFUSAL_DOMAINS,
} = modelApi;

const { ensureYouTubeStoresLoaded } = youtubeApi;
const { loadProgression, saveProgression, scheduleProgressionSave } = storeApi;

// Every mutating function below clones its input and returns a new object
// rather than mutating the state it was handed — the same contract
// progression-model.js's advanceStreak already keeps. structuredClone is
// available in every runtime this project targets (Chrome's worker, and
// Node 18+ for the test suite); no need for a JSON round trip.
function cloneState(state) {
  return structuredClone(state);
}

function nextDayKey(dayKey) {
  return dateKey(addDays(dateFromKey(dayKey), 1));
}

// ---------- 3.1 buildDaySnapshot ----------
//
// One domain loop does double duty: it accumulates the category totals
// analytics needs AND, for domains carrying a limit/restraint/block rule,
// the per-domain {scheduled, respected} pair settleDay needs to fold
// per-rule streaks (02-ARCHITECTURE.md §4.2). Splitting that into a second
// pass over `sites` would mean resolving isScheduleDay/usageSecondsForDate
// twice for the same domain for no reason.
//
// gateCounters: { gatesShown: {domain: n}, gatesPassed: {domain: n} } —
// the live counters for the day being settled, or empty maps for a day
// that isn't "today" (see gateCountersFor below).
function buildDaySnapshot(sites, dayKey, gateCounters) {
  const date = dateFromKey(dayKey) || new Date();
  const gatesShownMap = (gateCounters && gateCounters.gatesShown) || {};
  const gatesPassedMap = (gateCounters && gateCounters.gatesPassed) || {};

  let trackedSeconds = 0;
  let productiveSeconds = 0;
  let generalSeconds = 0;
  let leisureSeconds = 0;
  let violations = 0;
  let activeRules = 0;
  const ruleDays = {}; // domain -> { scheduled, respected }

  for (const domain of Object.keys(sites || {})) {
    const entry = sites[domain];
    const seconds = usageSecondsForDate(entry, dayKey, dayKey);

    if (seconds > 0) {
      trackedSeconds += seconds;
      for (const seg of entryCategorySegments(domain, entry, dayKey, sites, seconds)) {
        if (seg.macro === "Productivity") productiveSeconds += seg.seconds;
        else if (seg.macro === "Leisure") leisureSeconds += seg.seconds;
        else generalSeconds += seg.seconds;
      }
    }

    // Violations, and the per-rule streak fold, only apply to rules that
    // actually governed this domain on this day — never to `timesTripped`
    // (audit §6.4: it's an all-time counter, not day-scoped) and never to
    // a paused rule (a paused rule wasn't in force, so it can neither be
    // violated nor extend its streak).
    if (entry.paused) continue;

    if (entry.mode === "limit") {
      const scheduled = isScheduleDay(entry, date);
      if (!scheduled) {
        ruleDays[domain] = { scheduled: false, respected: false };
        continue;
      }
      activeRules++;
      const limitSeconds = (limitMinutesForDate(entry, date) || 0) * 60;
      const violated = limitSeconds > 0 && seconds > limitSeconds + VIOLATION_TOLERANCE_SECONDS;
      if (violated) violations++;
      ruleDays[domain] = { scheduled: true, respected: !violated };
    } else if (entry.mode === "restraint" || entry.mode === "block") {
      const scheduled = isScheduleDay(entry, date);
      if (!scheduled) {
        ruleDays[domain] = { scheduled: false, respected: false };
        continue;
      }
      activeRules++;
      const violated = (gatesPassedMap[domain] || 0) > 0;
      if (violated) violations++;
      ruleDays[domain] = { scheduled: true, respected: !violated };
    }
  }

  const focusScore = calculateFocusScore(sites, dayKey);

  // Refusals per domain, capped, then summed — the domain breakdown is kept
  // around (not just the total) because the blocked page's "Turned back
  // from this site: N times" line needs a per-domain lifetime figure
  // (03-IMPLEMENTATION-SPEC.md §6.3), and DayRecord itself has no room for
  // a per-domain map.
  let gatesShown = 0;
  let gatesPassed = 0;
  let refusals = 0;
  const refusalsByDomain = {};
  const gateDomains = new Set([...Object.keys(gatesShownMap), ...Object.keys(gatesPassedMap)]);
  for (const domain of gateDomains) {
    const shown = gatesShownMap[domain] || 0;
    const passed = gatesPassedMap[domain] || 0;
    gatesShown += shown;
    gatesPassed += passed;
    const domainRefusals = Math.min(Math.max(shown - passed, 0), REFUSAL_MAX_PER_DOMAIN_PER_DAY);
    if (domainRefusals > 0) refusalsByDomain[domain] = domainRefusals;
    refusals += domainRefusals;
  }

  return {
    dayKey,
    trackedSeconds,
    productiveSeconds,
    generalSeconds,
    leisureSeconds,
    focusScore,
    violations,
    gatesShown,
    gatesPassed,
    refusals,
    refusalsByDomain,
    activeRules,
    ruleDays,
  };
}

// A day older than the live `today` counters never has gate data — those
// counters only exist for the in-progress day. Settlement only ever calls
// this with dayKey === state.today.date in practice (it never settles
// today, per the loop condition below), but the check is what makes that
// invariant explicit rather than assumed.
function gateCountersFor(state, dayKey) {
  if (state.today && state.today.date === dayKey) {
    return { gatesShown: state.today.gatesShown || {}, gatesPassed: state.today.gatesPassed || {} };
  }
  return { gatesShown: {}, gatesPassed: {} };
}

function applyLevelXp(state, xp, atDayKey) {
  if (!xp) return;
  state.level.xp += xp;
  const progress = xpProgressForLevel(state.level.xp);
  const prevLevel = state.level.level;
  state.level.level = progress.level;
  state.level.rankId = progress.rank.id;
  if (progress.level > prevLevel) {
    state.level.lastLevelUp = { level: progress.level, at: atDayKey, seen: false };
  }
}

// ---------- 3.2 settleDay ----------
//
// Step order is load-bearing, not stylistic: achievements (9) must run
// after streaks (3/4) and lifetime counters (7) so a predicate reading
// e.g. streaks.discipline.current sees the day just settled, and level XP
// (10) must include achievement XP so a day that both holds the standard
// and earns an achievement levels up in one settlement, not two.
function settleDay(state, sites, dayKey) {
  const next = cloneState(state);

  const snapshot = buildDaySnapshot(sites, dayKey, gateCountersFor(next, dayKey));
  const conditions = evaluateConditions(snapshot, next.config);

  // 3 — discipline streak
  const streakAfter = advanceStreak(next.streaks.discipline, conditions, dayKey);
  next.streaks.discipline = streakAfter;

  // 4 — per-rule streaks, only for domains a rule actually governed today
  for (const [domain, info] of Object.entries(snapshot.ruleDays)) {
    const existing = next.streaks.rules[domain] || { current: 0, best: 0, lastDate: null };
    next.streaks.rules[domain] = advanceRuleStreak(
      existing,
      { respected: info.respected, scheduled: info.scheduled },
      dayKey
    );
  }

  // 5 — day XP
  const { total } = computeDayXp({ snapshot, conditions, streakAfter: streakAfter.current });

  // 6 — append the DayRecord. Short keys are deliberate (400 of these live
  // in storage permanently, 02-ARCHITECTURE.md §3.2) and match exactly what
  // the achievement/record predicates in progression-model.js already read
  // (day.a, day.t, day.l, day.f, ...).
  const dayRecord = {
    d: dayKey,
    t: snapshot.trackedSeconds,
    p: snapshot.productiveSeconds,
    g: snapshot.generalSeconds,
    l: snapshot.leisureSeconds,
    f: snapshot.focusScore,
    c1: conditions.c1 ? 1 : 0,
    c2: conditions.c2 ? 1 : 0,
    c3: conditions.c3 ? 1 : 0,
    h: conditions.held ? 1 : 0,
    a: conditions.absent ? 1 : 0,
    v: snapshot.violations,
    gs: snapshot.gatesShown,
    gp: snapshot.gatesPassed,
    r: snapshot.refusals,
    ar: snapshot.activeRules,
    xp: total,
    st: streakAfter.current,
  };
  next.days.push(dayRecord);

  // 7 — lifetime counters. An absent day contributes seconds/gates/refusals
  // (all zero anyway) but must not increment daysTracked — that is the
  // whole distinction between "absent" and "missed" (T6).
  const lifetime = next.lifetime;
  if (!conditions.absent) {
    lifetime.daysTracked = (lifetime.daysTracked || 0) + 1;
    if (conditions.held) lifetime.daysHeld = (lifetime.daysHeld || 0) + 1;
  }
  lifetime.trackedSeconds = (lifetime.trackedSeconds || 0) + snapshot.trackedSeconds;
  lifetime.productiveSeconds = (lifetime.productiveSeconds || 0) + snapshot.productiveSeconds;
  lifetime.generalSeconds = (lifetime.generalSeconds || 0) + snapshot.generalSeconds;
  lifetime.leisureSeconds = (lifetime.leisureSeconds || 0) + snapshot.leisureSeconds;
  lifetime.gatesShown = (lifetime.gatesShown || 0) + snapshot.gatesShown;
  lifetime.gatesPassed = (lifetime.gatesPassed || 0) + snapshot.gatesPassed;
  lifetime.refusals = (lifetime.refusals || 0) + snapshot.refusals;
  lifetime.violations = (lifetime.violations || 0) + snapshot.violations;
  lifetime.xpFromDays = (lifetime.xpFromDays || 0) + total;
  lifetime.refusalsByDomain = lifetime.refusalsByDomain || {};
  for (const [domain, count] of Object.entries(snapshot.refusalsByDomain)) {
    lifetime.refusalsByDomain[domain] = (lifetime.refusalsByDomain[domain] || 0) + count;
  }

  // 8 — records (day + state scope; week/month scope subjects are absent
  // from this ctx, so evaluateRecords skips them per its own qualifies-the-
  // subject-not-the-incumbent contract)
  const recordCtx = { day: dayRecord, streaks: next.streaks, lifetime: next.lifetime, dayKey };
  const recordsResult = evaluateRecords(next.records, recordCtx);
  next.records = recordsResult.updated;

  // 9 — achievements, after streaks/lifetime/records so predicates see the
  // day just settled. One-shot and irrevocable (T2): never re-test an id
  // that's already in state.achievements.
  const achievementCtx = {
    state: next,
    day: dayRecord,
    days: next.days,
    weeks: next.weeks,
    months: next.months,
    streaks: next.streaks,
    lifetime: next.lifetime,
    config: next.config,
  };
  let achievementXp = 0;
  for (const def of ACHIEVEMENTS) {
    if (next.achievements[def.id]) continue;
    if (def.test(achievementCtx)) {
      next.achievements[def.id] = { at: dayKey, ts: Date.now() };
      achievementXp += def.xp;
    }
  }
  lifetime.xpFromAchievements = (lifetime.xpFromAchievements || 0) + achievementXp;

  // 10 — apply XP, recompute level, detect level-up
  applyLevelXp(next, total + achievementXp, dayKey);

  // 11 — advance the settlement cursor
  next.settlement.lastSettledDate = dayKey;

  return next;
}

// ---------- 3.4 settleWeek / settleMonth ----------

function computeWeekRollup(days, weekKey) {
  const weekDays = (days || []).filter((d) => isoWeekKey(dateFromKey(d.d)) === weekKey);
  const nonAbsent = weekDays.filter((d) => d.a === 0);
  const held = weekDays.filter((d) => d.h === 1).length;
  const t = weekDays.reduce((sum, d) => sum + d.t, 0);
  const p = weekDays.reduce((sum, d) => sum + d.p, 0);
  const l = weekDays.reduce((sum, d) => sum + d.l, 0);
  const f = nonAbsent.length ? Math.round(nonAbsent.reduce((sum, d) => sum + d.f, 0) / nonAbsent.length) : 0;
  return { held, recorded: nonAbsent.length, t, p, l, f };
}

function computeMonthRollup(days, monthKeyStr) {
  const monthDays = (days || []).filter((d) => monthKey(dateFromKey(d.d)) === monthKeyStr);
  const nonAbsent = monthDays.filter((d) => d.a === 0);
  const held = monthDays.filter((d) => d.h === 1).length;
  const t = monthDays.reduce((sum, d) => sum + d.t, 0);
  const p = monthDays.reduce((sum, d) => sum + d.p, 0);
  const l = monthDays.reduce((sum, d) => sum + d.l, 0);
  const f = nonAbsent.length ? Math.round(nonAbsent.reduce((sum, d) => sum + d.f, 0) / nonAbsent.length) : 0;
  // Informational rollups only — settleMonth awards no XP (01-PRODUCT-DESIGN
  // §2.9 only defines a weekly bonus), so these are just sums of what the
  // days already earned, not a new award.
  const xp = monthDays.reduce((sum, d) => sum + d.xp, 0);
  const refusals = monthDays.reduce((sum, d) => sum + d.r, 0);
  return { held, recorded: nonAbsent.length, t, p, l, f, xp, refusals };
}

// Guarded by lastWeekSettled rather than relying solely on the catch-up
// loop only ever visiting a given day once — the field is part of the data
// model (02-ARCHITECTURE.md §3.1) specifically so a week's settlement is
// self-evidently idempotent from the state alone.
function settleWeek(state, weekKey, closingDayKey) {
  if (state.settlement.lastWeekSettled === weekKey) return state;
  const next = cloneState(state);

  const rollup = computeWeekRollup(next.days, weekKey);
  const { xp, tier } = computeWeekXp(rollup.held);
  const weekRecord = { w: weekKey, ...rollup, xp, tier };
  next.weeks.push(weekRecord);

  next.lifetime.xpFromWeeks = (next.lifetime.xpFromWeeks || 0) + xp;
  applyLevelXp(next, xp, closingDayKey);

  const recordsResult = evaluateRecords(next.records, {
    week: weekRecord,
    streaks: next.streaks,
    lifetime: next.lifetime,
    dayKey: closingDayKey,
  });
  next.records = recordsResult.updated;

  next.settlement.lastWeekSettled = weekKey;
  return next;
}

// No dedicated "lastMonthSettled" field exists in the data model (only
// lastWeekSettled does, 02-ARCHITECTURE.md §3.1) — months.some(...) is an
// equally sufficient idempotency check without inventing a new field for
// something the array already tells us.
function settleMonth(state, monthKeyStr, closingDayKey) {
  if (state.months.some((m) => m.m === monthKeyStr)) return state;
  const next = cloneState(state);

  const rollup = computeMonthRollup(next.days, monthKeyStr);
  const monthRecord = { m: monthKeyStr, ...rollup };
  next.months.push(monthRecord);

  const recordsResult = evaluateRecords(next.records, {
    month: monthRecord,
    streaks: next.streaks,
    lifetime: next.lifetime,
    dayKey: closingDayKey,
  });
  next.records = recordsResult.updated;

  return next;
}

// ---------- 3.3 settleThrough (cold start + catch-up loop) ----------
//
// Only the six historical days still sitting in `sites[].history` can ever
// be back-filled (audit §6.2) — clamping the seed to 7 days back is what
// keeps a first-ever run from either fabricating older absent days or
// missing real ones still in `history`.
function seedFirstDay(sites, todayKey) {
  let earliest = null;
  for (const domain of Object.keys(sites || {})) {
    const entry = sites[domain];
    const candidates = [entry.createdAt, entry.lastReset, ...((entry.history || []).map((h) => h.date))].filter(
      Boolean
    );
    for (const c of candidates) {
      if (!earliest || c < earliest) earliest = c;
    }
  }
  if (!earliest) earliest = todayKey; // nothing tracked yet — nothing to back-fill
  const floor = dateKey(addDays(dateFromKey(todayKey), -7));
  return earliest < floor ? floor : earliest;
}

// The pure engine core: takes a progression state and a `sites` map, walks
// every un-settled day strictly before todayKey, and returns a new state.
// No chrome.*, no storage — this is what makes it testable with a
// hand-built state fixture standing in for the store (02-ARCHITECTURE.md
// §8's "engine with a fake store"). settleThrough() below is the only
// caller that talks to real storage.
//
// The one exception to "no IO" is priming the YouTube stores — a snapshot
// built before that would score a day of lecture-watching as leisure
// (03-IMPLEMENTATION-SPEC.md, "things easy to get wrong"). That priming is
// itself chrome-free under Node (youtube-classifier.js falls back to its
// in-memory snapshot when chrome.storage isn't present), so it doesn't
// reintroduce a chrome dependency into this function.
async function settleThroughState(rawState, sites, todayKey) {
  await ensureYouTubeStoresLoaded();

  const seeded = !rawState.settlement.lastSettledDate;
  let working = cloneState(rawState);
  let cursor = seeded ? seedFirstDay(sites, todayKey) : nextDayKey(working.settlement.lastSettledDate);
  if (seeded) working.lifetime.firstDay = cursor;

  let iterations = 0;
  // Strictly less-than: settling today would freeze a partial day and,
  // because settled days are never revisited (I3), it would then never be
  // revisited to pick up the rest of it.
  while (cursor < todayKey && iterations < MAX_CATCHUP_DAYS) {
    working = settleDay(working, sites, cursor);
    if (isWeekEnd(cursor)) working = settleWeek(working, isoWeekKey(cursor), cursor);
    if (isMonthEnd(cursor)) working = settleMonth(working, monthKey(cursor), cursor);
    cursor = nextDayKey(cursor);
    iterations++;
  }

  if (working.today.date !== todayKey) {
    working.today = { date: todayKey, gatesShown: {}, gatesPassed: {} };
  }

  if (working.days.length > MAX_LEDGER_DAYS) {
    working.days = working.days.slice(working.days.length - MAX_LEDGER_DAYS);
  }
  if (working.weeks.length > MAX_LEDGER_WEEKS) {
    working.weeks = working.weeks.slice(working.weeks.length - MAX_LEDGER_WEEKS);
  }
  // Streaks are folded forward and never recomputed from days[] (guardrail
  // #4) — pruning here only drops bookkeeping for rules that no longer
  // exist, never touches the streak values themselves.
  for (const domain of Object.keys(working.streaks.rules)) {
    if (!sites || !Object.prototype.hasOwnProperty.call(sites, domain)) {
      delete working.streaks.rules[domain];
    }
  }
  // refusalsByDomain is unbounded in principle (a new domain every visit,
  // over years) — keep only the most-refused MAX_REFUSAL_DOMAINS entries,
  // same shape of cap as days/weeks above (03-IMPLEMENTATION-SPEC.md §6.3).
  const refusalDomains = Object.keys(working.lifetime.refusalsByDomain || {});
  if (refusalDomains.length > MAX_REFUSAL_DOMAINS) {
    const kept = refusalDomains
      .sort((a, b) => working.lifetime.refusalsByDomain[b] - working.lifetime.refusalsByDomain[a])
      .slice(0, MAX_REFUSAL_DOMAINS);
    const prunedMap = {};
    for (const domain of kept) prunedMap[domain] = working.lifetime.refusalsByDomain[domain];
    working.lifetime.refusalsByDomain = prunedMap;
  }

  return working;
}

// ---------- 3.5 recordEvent ----------
//
// Pure core: rolls `today` to the current date first (so an event arriving
// just after midnight, before the next settlement run, lands on today's
// counters rather than yesterday's — "things easy to get wrong" in the
// spec), then applies exactly one of the five event types. Events only ever
// touch state.today or lifetime counters; they never award XP directly —
// every bit of XP in the ledger comes from a settlement so the economy
// stays auditable to a DayRecord, a WeekRecord or an achievement.
function applyEvent(state, type, payload, todayKey) {
  const next = cloneState(state);
  if (next.today.date !== todayKey) {
    next.today = { date: todayKey, gatesShown: {}, gatesPassed: {} };
  }

  const domain = payload && payload.domain;
  switch (type) {
    case "gate_shown":
      next.today.gatesShown[domain] = (next.today.gatesShown[domain] || 0) + 1;
      break;
    case "gate_passed":
      next.today.gatesPassed[domain] = (next.today.gatesPassed[domain] || 0) + 1;
      break;
    case "rule_created":
      next.lifetime.rulesCreated = (next.lifetime.rulesCreated || 0) + 1;
      break;
    case "rule_deleted":
      delete next.streaks.rules[domain];
      break;
    case "rule_loosened":
      next.lifetime.rulesLoosened = (next.lifetime.rulesLoosened || 0) + 1;
      break;
    case "level_up_seen":
      // Dismissal only ever flips the flag already set by settleDay's
      // applyLevelXp — it never touches level/xp themselves (T2).
      if (next.level.lastLevelUp) next.level.lastLevelUp.seen = true;
      break;
    case "config_updated":
      // Clamping to the product-defined ranges (15-240 / 40-90) is the
      // caller's job (options.js) — this just writes whatever it's handed
      // into state.config, the same way every other event is a thin
      // pass-through onto state.
      if (payload && typeof payload.leisureCeilingMinutes === "number") {
        next.config.leisureCeilingMinutes = payload.leisureCeilingMinutes;
      }
      if (payload && typeof payload.focusTarget === "number") {
        next.config.focusTarget = payload.focusTarget;
      }
      break;
    default:
      break; // unknown event type — ignore rather than throw
  }
  return next;
}

// ---------- IO shell (worker only) ----------

async function settleThrough(todayKey = todayStr()) {
  const state = await loadProgression();
  const sites = await getSites();
  const settled = await settleThroughState(state, sites, todayKey);
  settled.settlement.lastRunAt = Date.now();
  await saveProgression(settled);
  return settled;
}

async function recordEvent(type, payload) {
  const state = await loadProgression();
  const next = applyEvent(state, type, payload, todayStr());
  scheduleProgressionSave(next);
  return next;
}

const progressionEngineApi = {
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
  settleThrough,
  recordEvent,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = progressionEngineApi;
} else {
  Object.assign(self, progressionEngineApi);
}

})();
