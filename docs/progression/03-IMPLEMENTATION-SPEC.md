# Progression System — Implementation Specification

**Audience:** the engineer implementing this. Every product and architecture
decision is already made. If you find yourself deciding something, it is either
specified below or in `01-PRODUCT-DESIGN.md` / `02-ARCHITECTURE.md` — go read it
rather than inventing an answer. If it is genuinely absent, note it and pick the
option that adds the least state.

**House rules for this codebase (non-negotiable):**
- Classic scripts only. No `import`/`export`, no bundler, no framework, no npm
  dependencies. Every new JS file ends with the `module.exports` tail pattern used
  by `common.js:1855`.
- Comments explain *why*, at the density of the surrounding files. Do not write
  `// increment the counter`.
- No new permissions in `manifest.json`.
- No `chrome.notifications` calls from progression code, ever.
- Match existing naming: `camelCase` functions, `SCREAMING_SNAKE` constants,
  `kebab-case` CSS classes prefixed `prog-`.

Work in the phase order given. Each phase ends in a state where `npm test` passes
and the extension still loads.

---

## Phase 0 — Precondition fix in `common.js`

**0.1** In `usageSecondsForDate` (`common.js:455`), replace:

```js
if (key === today && entry.lastReset === today) return entry.usedSeconds || 0;
```
with:
```js
// An entry only rolls its counter into `history` when ensureReset() next runs
// for that domain, which happens lazily on the next visit. Settlement reads a
// day after it has ended, so a still-unrolled entry must be read straight off
// usedSeconds — keying on lastReset rather than on "is this today" is both more
// correct and identical in the common case.
if (entry.lastReset === key) return entry.usedSeconds || 0;
```

The `today` parameter stays in the signature (callers pass it; removing it is
out of scope).

**0.2** Add to `test/common.test.js`:

```js
test("usageSecondsForDate: reads a past day still sitting in usedSeconds", () => {
  const entry = { lastReset: "2026-07-27", usedSeconds: 600, history: [] };
  assert.equal(usageSecondsForDate(entry, "2026-07-27", "2026-07-28"), 600);
  assert.equal(usageSecondsForDate(entry, "2026-07-26", "2026-07-28"), 0);
});
```
(Add `usageSecondsForDate` to that file's require destructure.)

**Acceptance:** `npm test` green. No other behaviour changes.

---

## Phase 1 — `progression-model.js`

Pure. No `chrome.*`, no storage, no `sites`. This file is where all the
arithmetic lives and it is the only file that needs exhaustive tests.

### 1.1 Constants (exact values — do not tune)

```js
const PROGRESSION_SCHEMA_VERSION = 1;

// XP economy
const XP_CONDITION_ADHERENCE = 25;
const XP_CONDITION_RESTRAINT = 25;
const XP_CONDITION_FOCUS     = 25;
const XP_DAY_HELD_BONUS      = 25;
const XP_STREAK_PER_DAY      = 2;
const XP_STREAK_CAP          = 50;
const XP_REFUSAL             = 10;
const REFUSAL_MAX_PER_DOMAIN_PER_DAY = 3;
const XP_REFUSAL_DAILY_CAP   = 30;
const WEEK_XP_TIERS = { 5: 75, 6: 110, 7: 150 };

// Level curve: cost(L -> L+1) = LEVEL_BASE_COST + LEVEL_COST_STEP * (L - 1)
const LEVEL_BASE_COST = 100;
const LEVEL_COST_STEP = 60;

// Day conditions
const DEFAULT_LEISURE_CEILING_MINUTES = 60;   // user range 15..240
const DEFAULT_FOCUS_TARGET = 60;              // user range 40..90
const MIN_TRACKED_MINUTES_FOR_FOCUS = 30;     // below this, C3 is waived
const VIOLATION_TOLERANCE_SECONDS = 30;       // absorbs tick granularity

// Retention
const MAX_LEDGER_DAYS = 400;
const MAX_LEDGER_WEEKS = 120;
const MAX_CATCHUP_DAYS = 400;

const RANKS = [
  { id: "observer",     name: "Observer",      minLevel: 1,  descriptor: "You are watching your own behaviour." },
  { id: "deliberate",   name: "Deliberate",    minLevel: 6,  descriptor: "Fewer decisions are being made for you." },
  { id: "measured",     name: "Measured",      minLevel: 11, descriptor: "You know what a good day costs." },
  { id: "consistent",   name: "Consistent",    minLevel: 16, descriptor: "Good days have stopped being unusual." },
  { id: "disciplined",  name: "Disciplined",   minLevel: 21, descriptor: "The standard holds without negotiation." },
  { id: "tempered",     name: "Tempered",      minLevel: 26, descriptor: "Restraint is no longer effortful." },
  { id: "composed",     name: "Composed",      minLevel: 31, descriptor: "The impulse arrives and nothing follows it." },
  { id: "self_governed",name: "Self-Governed", minLevel: 36, descriptor: "You set the terms." },
];
```

### 1.2 Level curve

The constants in §1.1 are authoritative. The closed form is derived from them:

```
cost(L → L+1) = LEVEL_BASE_COST + LEVEL_COST_STEP·(L−1)
cumulative(L) = Σ cost(k) for k = 1..L−1
              = LEVEL_BASE_COST·(L−1) + (LEVEL_COST_STEP / 2)·(L−1)(L−2)
              = 100(L−1) + 30(L−1)(L−2)        with BASE = 100, STEP = 60
```

Derive it from the constants in code; do not hard-code `100` and `30` in the
function body, or the two can drift apart again.

```js
// Cumulative XP required to be AT level L. cumulativeXpForLevel(1) === 0.
function cumulativeXpForLevel(level)
function levelForXp(xp)                // inverse; solve the quadratic, then correct
                                       // by ±1 in a loop to kill float error. Never < 1.
function xpProgressForLevel(xp)        // -> { level, rank, xpIntoLevel, xpForNextLevel, pct }
function rankForLevel(level)           // -> RANKS entry (last one wins for 36+)
```

Verify in tests: `cumulativeXpForLevel(2) === 100`, `(3) === 260`, `(4) === 480`,
`(5) === 760`, `(10) === 3060`, `(20) === 12160`, `(40) === 48360`;
`levelForXp(0) === 1`, `levelForXp(99) === 1`, `levelForXp(100) === 2`,
`levelForXp(759) === 4`, `levelForXp(760) === 5`.

Add one property test as well, which is what makes this class of drift
impossible to reintroduce:

```js
for (let L = 1; L <= 60; L++) {
  assert.equal(
    cumulativeXpForLevel(L + 1) - cumulativeXpForLevel(L),
    LEVEL_BASE_COST + LEVEL_COST_STEP * (L - 1)
  );
  assert.equal(levelForXp(cumulativeXpForLevel(L)), L);
  assert.equal(levelForXp(cumulativeXpForLevel(L + 1) - 1), L);
}
```

### 1.3 Date/period helpers

```js
function isoWeekKey(dateOrKey)   // "2026-W31", ISO-8601, Monday start, correct across
                                 // year boundaries (Jan 1 can be W52/W53 of the prior year)
function monthKey(dateOrKey)     // "2026-07"
function isWeekEnd(dateOrKey)    // true on Sunday
function isMonthEnd(dateOrKey)
function lastNDays(days, n)      // tail slice
function consecutiveFrom(days, predicate)  // length of the run ending at the newest entry
```

`dateKey`, `addDays`, `dateFromKey` come from `common.js` — require/reference
them, do not reimplement.

### 1.4 Day conditions

```js
// snapshot: { dayKey, trackedSeconds, productiveSeconds, generalSeconds,
//             leisureSeconds, focusScore, violations, gatesShown, gatesPassed,
//             refusals, activeRules }
// config:   { leisureCeilingMinutes, focusTarget, minTrackedMinutesForFocus }
function evaluateConditions(snapshot, config) -> {
  absent: boolean,          // trackedSeconds === 0 && gatesShown === 0
  c1: boolean,              // violations === 0
  c2: boolean,              // leisureSeconds <= leisureCeilingMinutes * 60
  c3: boolean,              // waived OR focusScore >= focusTarget
  focusWaived: boolean,     // trackedSeconds < minTrackedMinutesForFocus * 60
  held: boolean             // c1 && c2 && c3 && !absent
}
```

An absent day has `held: false` and `c1/c2/c3` reported as `false` — but the
streak logic keys on `absent` first, so it is never treated as a break.

### 1.5 Streak transition

```js
function advanceStreak(streak, { held, absent }, dayKey) -> newStreak
```
Pure; returns a new object, does not mutate. Four cases exactly as in
`02-ARCHITECTURE.md` §4.2. When a run ends, set `lastBrokenFrom` to the length
that just ended (this is what `back_on` reads). When `current` exceeds `best`,
update `best`, `bestStart` (= `currentStart`) and `bestEnd` (= `dayKey`).

Same function shape for per-rule streaks:
```js
function advanceRuleStreak(ruleStreak, { respected, scheduled }, dayKey)
```
`scheduled === false` → return unchanged (off-schedule days neither extend nor break).

### 1.6 XP rules registry

```js
const DAY_XP_RULES = [
  { id: "adherence", label: "No rule broken",     compute: (ctx) => ctx.conditions.c1 ? XP_CONDITION_ADHERENCE : 0 },
  { id: "restraint", label: "Leisure under ceiling", compute: (ctx) => ctx.conditions.c2 ? XP_CONDITION_RESTRAINT : 0 },
  { id: "focus",     label: "Focus target met",   compute: (ctx) => ctx.conditions.c3 ? XP_CONDITION_FOCUS : 0 },
  { id: "held",      label: "Standard held",      compute: (ctx) => ctx.conditions.held ? XP_DAY_HELD_BONUS : 0 },
  { id: "streak",    label: "Streak bonus",       compute: (ctx) => ctx.conditions.held
                                                      ? Math.min(XP_STREAK_CAP, XP_STREAK_PER_DAY * ctx.streakAfter) : 0 },
  { id: "refusals",  label: "Turned back",        compute: (ctx) => Math.min(XP_REFUSAL_DAILY_CAP, XP_REFUSAL * ctx.snapshot.refusals) },
];

function registerDayXpRule(rule)            // push; extension point
function computeDayXp(ctx) -> { total, breakdown: [{ id, label, xp }] }
```
If `ctx.conditions.absent`, return `{ total: 0, breakdown: [] }` before running
any rule.

```js
function computeWeekXp(heldDays) -> { xp, tier }   // WEEK_XP_TIERS, 0 below 5
```

### 1.7 Achievements

`const ACHIEVEMENTS = [ ... ]` — all 27 from `01-PRODUCT-DESIGN.md` §5, in that
order, each `{ id, name, kind, xp, criterion, test(ctx), progress(ctx)? }`.

`ctx` = `{ state, day, days, weeks, months, streaks, lifetime, config }` where
`day` is the `DayRecord` just settled and `days`/`weeks`/`months` include it.

Predicate notes:
- `first_rule` / `first_week` → `lifetime.rulesCreated >= 1` / `lifetime.daysTracked >= 7`.
- `clean_*` → `streaks.discipline.current >= N`.
- `refusals_*` → `lifetime.refusals >= N`. `first_refusal` → `>= 1`.
- `silent_day` → `day.a === 0 && day.t > 0 && day.l === 0`.
- `quiet_week` → `consecutiveFrom(days, d => d.a === 0 && d.l <= 30*60) >= 7`.
- `silent_week` → same with `d.l === 0`.
- `deep_day` → `day.f >= 90 && day.t >= 7200`.
- `deep_week` → over `lastNDays(days, 7)`, at least 5 with `a === 0`, and the
  mean `f` of those non-absent days `>= 80`.
- `unbroken_30` / `ironclad_100` → `Math.max(...Object.values(streaks.rules).map(r => r.current))` `>= 30 / 100`.
- `days_*` → `lifetime.daysTracked >= N`. `productive_*h` → `lifetime.productiveSeconds >= N*3600`.
- `downward_trend` → over the last 5 `weeks` entries, 4 consecutive strict decreases in `l`.
- `back_on` → `streaks.discipline.current >= 7 && streaks.discipline.lastBrokenFrom >= 14`.

`registerAchievement(def)` — extension point.

### 1.8 Records

`const RECORDS = [ ... ]` — all 8 from `01-PRODUCT-DESIGN.md` §6, each
`{ id, label, scope, direction, qualifies?, extract, meta? }`.

```js
function evaluateRecords(existing, ctx) -> { updated, beaten: [id] }
```
`direction: "min"` only replaces when the existing record is absent or the new
value is strictly lower. `qualifies` gates the *candidate*, never the incumbent.
`registerRecord(def)` — extension point.

**Acceptance for Phase 1:** `test/progression-model.test.js` covers every
function above; `npm test` green. No other file changed yet.

---

## Phase 2 — `progression-store.js`

```js
const PROGRESSION_KEY = "progression";

function defaultProgressionState()     // exact shape from 02-ARCHITECTURE.md §3.1
function migrateProgressionState(raw)  // switch on raw.version; v1 is the floor.
                                       // May add fields with defaults; must never
                                       // recompute an existing DayRecord.
async function loadProgression()       // chrome.storage.local ONLY. Caches in memory.
async function saveProgression(state)  // immediate write
function scheduleProgressionSave(state)// debounced 2000ms; flushProgressionSave() forces
function getProgressionSync()          // last cached snapshot, or defaults; for renderers
async function sendProgressionEvent(type, payload)  // non-worker contexts:
                                       // chrome.runtime.sendMessage({type:"PROGRESSION_EVENT",...})
                                       // Swallows "no receiving end" errors like blocked.js does.
```

Keep the cache fresh with a `chrome.storage.onChanged` listener on
`area === "local"` for `PROGRESSION_KEY`, mirroring `common.js:112-118`.

Guard against non-worker writes: if `saveProgression` is called from a context
without `chrome.alarms` (i.e. a page), `console.warn` and no-op. Invariant I1.

---

## Phase 3 — `progression-engine.js` (service worker only)

### 3.1 `buildDaySnapshot(sites, dayKey, gateCounters)`

Returns the snapshot shape from §1.4. Implementation notes:

```js
const date = dateFromKey(dayKey) || new Date();
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
  // violations — only for rules that actually applied that day
  if (entry.paused) continue;
  if (entry.mode === "limit" && isScheduleDay(entry, date)) {
    activeRules++;
    const limitSec = (limitMinutesForDate(entry, date) || 0) * 60;
    if (limitSec > 0 && seconds > limitSec + VIOLATION_TOLERANCE_SECONDS) violations++;
  } else if ((entry.mode === "restraint" || entry.mode === "block") && isScheduleDay(entry, date)) {
    activeRules++;
    if ((gateCounters.gatesPassed[domain] || 0) > 0) violations++;
  }
}
focusScore = calculateFocusScore(sites, dayKey);
refusals = Σ min(max(shown[d] - passed[d], 0), REFUSAL_MAX_PER_DOMAIN_PER_DAY);
```

Call `ensureYouTubeStoresLoaded()` once before the first snapshot in a settlement
run — `popup.js:159` does the same thing for the same reason (unprimed stores
would score lecture watching as leisure).

**Do not use `entry.timesTripped` anywhere.** Audit §6.4.

### 3.2 `settleDay(state, sites, dayKey)`

Strict order — do not rearrange:

1. `snapshot = buildDaySnapshot(sites, dayKey, gateCountersFor(state, dayKey))`
2. `conditions = evaluateConditions(snapshot, state.config)`
3. `streakAfter = advanceStreak(state.streaks.discipline, conditions, dayKey)`
4. per-rule streaks: for each `limit`/`restraint`/`block` domain, `advanceRuleStreak`
5. `{ total, breakdown } = computeDayXp({ snapshot, conditions, streakAfter: streakAfter.current })`
6. append the `DayRecord` (short keys, §3.2 of the architecture doc)
7. lifetime counters: `daysTracked` (+1 unless absent), `daysHeld`, seconds
   totals, `gatesShown`, `gatesPassed`, `refusals`, `violations`, `xpFromDays`
8. `evaluateRecords`
9. achievement pass (after 7 and 8, so predicates see current values)
10. `applyXp(state, total + achievementXp)` → recompute `level`, set
    `lastLevelUp: { level, at: dayKey, seen: false }` if the level increased
11. `state.settlement.lastSettledDate = dayKey`

`gateCountersFor` returns `state.today` counters when `state.today.date === dayKey`,
otherwise empty maps (a day older than the live counters has no gate data).

### 3.3 `settleThrough(todayKey)`

Per `02-ARCHITECTURE.md` §4.3. Wrap it in
`createCoalescingRunner` from `background-logic.js` — it is already imported in
the worker and is exactly the right primitive.

Cold start: when `settlement.lastSettledDate` is null, seed the cursor from the
earliest date found across `sites` (`entry.createdAt`, `entry.lastReset`, and
`history[].date`), clamped to at most 7 days before today. Set
`lifetime.firstDay` to that date.

After the loop: if `state.today.date !== todayKey`, reset
`state.today = { date: todayKey, gatesShown: {}, gatesPassed: {} }`. Then prune
`days` to `MAX_LEDGER_DAYS`, `weeks` to `MAX_LEDGER_WEEKS`, and delete
`streaks.rules` entries whose domain is no longer in `sites`. Save immediately.

### 3.4 `settleWeek` / `settleMonth`

On a settled day that is a Sunday, build the `WeekRecord` from the days of that
ISO week present in `days[]`: `held`, `recorded` (non-absent count), summed
seconds, mean focus over non-absent days, `computeWeekXp(held)`. Add the week XP
to `lifetime.xpFromWeeks` and to the level total. Guard with
`settlement.lastWeekSettled` so a week is never settled twice.
`settleMonth` is the same shape on the last day of a month; it awards no XP.

### 3.5 `recordEvent(type, payload)`

```js
gate_shown   → state.today.gatesShown[domain]++      (after date-rolling state.today)
gate_passed  → state.today.gatesPassed[domain]++
rule_created → lifetime.rulesCreated++
rule_deleted → no counter; drop streaks.rules[domain]
rule_loosened→ lifetime.rulesLoosened++
```
Then `scheduleProgressionSave(state)`. Events never award XP directly.

---

## Phase 4 — wiring into `background.js`

1. Extend `importScripts` (order matters):
   `importScripts("common.js", "youtube-classifier.js", "background-logic.js", "progression-model.js", "progression-store.js", "progression-engine.js")`
2. In `navigateAfterTrip(tabId, key, entry, reason)`, before navigating:
   `recordEvent("gate_shown", { domain: key, reason })`.
   Fire for all three reasons (`limit`, `blocked`, `restraint`) — a limit page the
   user backs away from is a refusal too.
3. In the `GRANT_RESTRAINT_PASS` handler, alongside `grantRestraintPass(...)`:
   `recordEvent("gate_passed", { domain: message.domain })`.
4. In `tick()`, where `const rolledOver = ensureReset(entry)` is already
   computed: `if (rolledOver) runSettlement();` — fire-and-forget, after
   `saveSites`.
5. New alarm next to `TICK_ALARM`:
   ```js
   const SETTLE_ALARM = "stoic-progression-settle";
   chrome.alarms.create(SETTLE_ALARM, { periodInMinutes: 30 });
   ```
   and a branch in the existing `onAlarm` listener.
6. Message handlers in the existing `onMessage` listener:
   - `PROGRESSION_EVENT` → `recordEvent(message.eventType, message.payload)`, respond `{ok:true}`
   - `REQUEST_SETTLEMENT` → `runSettlement()`, respond `{ok:true}`
   Follow the existing `return true` async-response convention.
7. Call `runSettlement()` once at worker startup, in the existing
   `ensureYouTubeStoresLoaded().finally(...)` chain — after `runTick()`.

---

## Phase 5 — `progression-ui.js` + `progression.css`

Each function takes `(state, opts)` and returns an HTML **string**. No DOM
queries, no storage, no event listeners (callers wire those).

```js
renderLevelIdentity(state)      // ring + level + rank + descriptor + XP bar + "N XP to Level M"
renderTodayStanding(liveDay)    // three .prog-condition chips; liveDay comes from
                                // buildLiveDayView() below, not from the ledger
renderStreaks(state)            // current / best / per-rule list
renderContributionGrid(state)   // 53 columns x 7 rows, newest bottom-right, month labels
renderRecords(state)            // 8 tiles; unset records render "—" with the label
renderAchievements(state)       // earned grid then locked grid (criterion + progress bar)
renderLifetime(state)           // stat grid
renderPopupStrip(state, liveDay)// one compact row
```

Plus one small helper the surfaces share, in `progression-ui.js` because it needs
`common.js` analytics but no worker state:

```js
buildLiveDayView(sites, state)  // today's in-progress totals + conditions, so the
                                // three chips and the popup dots update live rather
                                // than lagging a day behind settlement.
                                // Reuses evaluateConditions with a snapshot built
                                // from today's sites; NOT written to the ledger.
```

**CSS** (`progression.css`, loaded by `popup.html` and `options.html`): use only
existing tokens. Grid cells `11px` with `3px` gap, `--radius-xs`. Level ring is
an SVG `circle` with `stroke-dasharray`, exactly like the focus gauge at
`popup.js:102-111` — copy that approach rather than inventing a second one.
No animation beyond `opacity`/`transform` transitions under 200ms.

---

## Phase 6 — surface integration

### 6.1 `popup.html` / `popup.js`
- Add `<script src="progression-model.js">`, `progression-store.js`,
  `progression-ui.js` before `popup.js`; add `<link>` for `progression.css`.
- Insert `<div id="progStrip" class="prog-strip"></div>` between the hero block
  and the Top Websites section.
- In `render()`: `const prog = await loadProgression();` then
  `progStrip.innerHTML = renderPopupStrip(prog, buildLiveDayView(sites, prog));`
- Send `REQUEST_SETTLEMENT` once on load (fire-and-forget) so an idle browser
  settles when the user checks in.
- Level-up banner: if `prog.level.lastLevelUp && !prog.level.lastLevelUp.seen`,
  render a dismissible inline banner above the strip. Dismiss sends
  `PROGRESSION_EVENT` with type `level_up_seen` (add that branch to `recordEvent`,
  setting `seen: true`).

### 6.2 `options.html` / `options.js`
- New `<button class="nav-tab" data-target="tab-progress">` as the **second** tab,
  with an icon in the style of the others (an upward trend line).
- New `<section class="tab-panel" id="tab-progress" hidden>` containing seven
  empty containers with the ids from `02-ARCHITECTURE.md` §7.
- `renderProgress()` called from `renderAll()`; fills each container from
  `progression-ui.js`.
- Preferences tab: two fields — "Leisure ceiling" (number, 15–240, min/day) and
  "Focus target" (number, 40–90). On change, send `PROGRESSION_EVENT`
  `config_updated` with the clamped values; `recordEvent` writes them into
  `state.config`. Include a one-line explanation of what each threshold changes.
- Rule save/delete: send `rule_created` on creating a new domain entry,
  `rule_deleted` on delete, and `rule_loosened` when the existing `isLoosening()`
  check (`options.js:252`) returns true.
- Export payload (`options.js:910`): add `progression: await loadProgression()`.
  On import, restore it only when `payload.progression?.version` is a supported
  schema version; otherwise leave the local state untouched and note it in
  `optImportNote`. Never merge two progression states — replace or skip.

### 6.3 `blocked.html` / `blocked.js`
- Load `progression-model.js` and `progression-store.js` before `blocked.js`.
- On the `reason === "restraint"` path only, add a second stat cell:
  `Turned back` / lifetime refusals for that domain. Compute as
  `Σ over days[] of (gs − gp)` for the domain — **but** `DayRecord` does not store
  per-domain gate data. Use the simpler, honest source instead: the running
  per-domain figure from `state.today` plus a new lifetime counter
  `lifetime.refusalsByDomain[domain]` maintained in `settleDay`. Add that field
  in Phase 3 step 7 (it is a small map; cap it to the 50 most-refused domains
  during pruning).
- No other change to the block page. It must not become a dashboard.

### 6.4 `manifest.json`
Add `progression-model.js`, `progression-store.js`, `progression-ui.js`,
`progression.css` to `web_accessible_resources.resources`.
Bump `version` to `2.3.0`. **No permission changes.**

---

## Phase 7 — tests

Per `02-ARCHITECTURE.md` §8. Minimum bar before this is considered done:

- `test/progression-model.test.js`: level curve boundary values listed in §1.2;
  `evaluateConditions` for held / partial / absent / focus-waived / vacuous-adherence;
  `computeDayXp` hitting the streak cap and the refusal cap; all four
  `advanceStreak` transitions plus the `lastBrokenFrom` bookkeeping;
  `isoWeekKey` for 2026-01-01, 2026-12-31 and a mid-year Monday/Sunday pair;
  every achievement predicate with a passing and a failing fixture;
  `evaluateRecords` for a `min`-direction record and for a candidate failing its qualifier.
- `test/progression-engine.test.js`: `buildDaySnapshot` category totals against a
  fixture `sites` map including one YouTube entry with an attribution map;
  limit-violation detection including the tolerance and the paused/off-schedule
  exemptions; `settleThrough` run twice produces byte-identical state;
  a 5-day gap settles 5 absent days without breaking the streak; cold start seeds
  `firstDay` correctly.
- `test/common.test.js`: the Phase 0 case.

---

## Manual verification checklist

1. Fresh profile → load unpacked → popup shows Level 1 · Observer · 0 XP.
2. Browse a few sites, add a `limit` rule, exceed it → block page appears →
   go back. Next day (or set the system clock forward and let the alarm fire):
   the day settles, C1 fails, XP reflects only C2/C3, one refusal is credited.
3. Set a restraint rule → complete the friction gate → next settlement records a
   violation and `gatesPassed` increments; XP for C1 is not awarded.
4. Close the browser for two days → reopen → two absent days appear in the grid
   as neutral cells and the streak is unchanged, not reset.
5. Toggle sync storage on in Preferences → confirm `progression` stays in
   `chrome.storage.local` (check `chrome://extensions` → service worker →
   `chrome.storage.sync.get(null)` shows only `sites`).
6. Export → wipe → import → level, streak, achievements and grid all return.
7. Light and dark themes: grid, ring and chips all legible; no hard-coded colours.
8. Confirm zero notifications ever originate from progression code.

---

## Things to get right that are easy to get wrong

- **Do not settle today.** The loop runs while `cursor < todayKey`. Settling the
  in-progress day would freeze a partial day and then never revisit it (I3).
- **`state.today` must be date-stamped and rolled** before any gate counter is
  incremented, or the first event after midnight lands on yesterday's counters.
- **`entryCategorySegments` needs the YouTube stores primed** or a day of
  lecture-watching settles as leisure. One `ensureYouTubeStoresLoaded()` per
  settlement run.
- **Achievements are one-shot.** Never re-award, never revoke, even if a
  predicate later becomes false.
- **XP is monotonic.** No code path may subtract from `level.xp`.
- **Pruning must not corrupt streaks.** Streaks are folded forward and stored in
  `state.streaks`; they are never recomputed from `days[]`, which is exactly why
  pruning at 400 days is safe. Do not "optimise" this into a recomputation.
- **Absent ≠ missed.** Two different cell colours, two different streak
  behaviours, and the difference is the product's position on rest (tenet T6).
</content>
</invoke>
