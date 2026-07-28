# Progression System — Software Architecture

Depends on: `00-AUDIT.md`, `01-PRODUCT-DESIGN.md`.
This document fixes the module boundaries, data shapes and control flow.
`03-IMPLEMENTATION-SPEC.md` turns it into ordered work.

---

## 1. Architectural invariants

These are not preferences. Violating any one of them produces a class of bug that
is hard to detect and impossible to repair after the fact.

**I1 — Only the service worker mutates progression state.**
`background.js` is the single writer. Popup, options and blocked pages read state
and post events via `chrome.runtime.sendMessage`. This eliminates every
read-modify-write race between contexts, which is exactly the hazard
`createCoalescingRunner` already exists to solve for `tick()`.

**I2 — Progression state lives in `chrome.storage.local`, unconditionally.**
Never in `sync`, regardless of the user's `storagePreference`. Audit §6.5: `sites`
already risks the sync quota, and progression is a per-device journal.

**I3 — Settled days are immutable.**
Once `settlement.lastSettledDate >= D`, nothing recomputes day D. This is what
makes XP and levels monotonic (product tenet T2) and what frees the ledger from
depending on classification state that may change later.

**I4 — Settlement is idempotent and catch-up capable.**
`settleThrough(todayKey)` may be called any number of times from any trigger. It
advances `lastSettledDate` one day at a time and is a no-op when already current.

**I5 — Pure logic is separated from IO.**
`progression-model.js` touches no `chrome.*` and no storage, mirroring
`background-logic.js`. It is the only file with non-trivial arithmetic and it is
the only file that needs thorough unit tests.

**I6 — No new tracking.** Every input is either already in `sites` or is an event
`background.js` already produces and currently discards.

**I7 — Extension points are registries, not `switch` statements.** XP rules,
achievements and records are arrays of declarative definitions, registered the
same way `registerClassifierRule` / `registerContentService` already work.

---

## 2. Module layout

Four new JS files and one CSS file. All classic scripts (no `import`/`export`),
each with a `module.exports` tail for Node tests, following `common.js` exactly.

```
common.js                  (existing — one bug fix, one helper added)
youtube-classifier.js      (existing — unchanged)
progression-model.js       NEW  pure logic, zero IO           ~550 lines
progression-store.js       NEW  storage IO + schema + migration ~250 lines
progression-engine.js      NEW  orchestration                  ~450 lines
progression-ui.js          NEW  shared render helpers          ~400 lines
progression.css            NEW  styling                        ~350 lines
```

**Load order** (must be exact — later files reference earlier globals):

| Context | Order |
|---|---|
| `background.js` | `importScripts("common.js", "youtube-classifier.js", "background-logic.js", "progression-model.js", "progression-store.js", "progression-engine.js")` |
| `popup.html`, `options.html` | `common.js` → `youtube-classifier.js` → `progression-model.js` → `progression-store.js` → `progression-ui.js` → surface script |
| `blocked.html` | `common.js` → `progression-model.js` → `progression-store.js` → `blocked.js` |

`progression-engine.js` is **not** loaded in page contexts (I1). Pages that need
a write send a message. Pages read through `progression-store.js`, which is
read-only outside the worker (§4.3).

### 2.1 Responsibilities

**`progression-model.js` — pure.**
Owns: all constants (XP values, thresholds, curve coefficients); the level curve
(`levelForXp`, `xpForLevel`, `rankForLevel`); day-condition evaluation
(`evaluateConditions`); XP computation (`computeDayXp`, `computeWeekXp`); streak
transitions (`advanceStreak`); the achievement definition table and its
predicates; the record definition table and its comparators; week/month key
helpers. Knows nothing about storage, `sites`, or Chrome.
Every function takes plain data and returns plain data.

**`progression-store.js` — IO.**
Owns: the storage key, the default state, schema versioning and migration, an
in-memory cache kept fresh by `chrome.storage.onChanged`, a debounced writer, and
the read API used by all surfaces. Also owns `sendProgressionEvent()` — the
message-posting helper used by non-worker contexts.

**`progression-engine.js` — orchestration, worker only.**
Owns: `recordEvent()`, `buildDaySnapshot()`, `settleThrough()`, `settleDay()`,
`settleWeek()`, the achievement evaluation pass, record updates, XP application
and level-up detection, retention pruning. This is the only file that reads
`sites` and calls `common.js` analytics.

**`progression-ui.js` — presentation.**
Owns: pure render functions returning HTML strings or elements — level ring, XP
bar, condition chips, streak block, contribution grid, records grid, achievement
grid, lifetime stat grid. No storage access; takes a state object, returns
markup. Shared by popup and options so the two surfaces cannot drift.

### 2.2 Dependency direction

```
progression-ui  ──▶ progression-model ──▶ (nothing)
                        ▲
progression-engine ─────┤──▶ progression-store ──▶ chrome.storage.local
       │                │
       └──▶ common.js (analytics, taxonomy, dates)
```

Nothing in `common.js` or `youtube-classifier.js` ever references progression.
The dependency points one way, as it already does for the YouTube module.

---

## 3. Data model

### 3.1 Root state — `chrome.storage.local["progression"]`

```js
{
  version: 1,

  level: {
    xp: 12480,                 // lifetime cumulative, monotonic
    level: 12,                 // derived, cached for cheap reads
    rankId: "measured",
    lastLevelUp: { level: 12, at: "2026-07-19", seen: false } | null
  },

  streaks: {
    discipline: {
      current: 14,
      currentStart: "2026-07-14",
      best: 31,
      bestStart: "2026-04-02",
      bestEnd: "2026-05-02",
      lastHeldDate: "2026-07-27",
      lastBrokenFrom: 31          // length of the most recently broken run; powers `back_on`
    },
    rules: {                       // keyed by domain
      "youtube.com": { current: 9, best: 22, lastDate: "2026-07-27" }
    }
  },

  lifetime: {
    firstDay: "2026-05-02",
    daysTracked: 87,            // days with any activity (absent days excluded)
    daysHeld: 61,
    trackedSeconds: 0,
    productiveSeconds: 0,
    generalSeconds: 0,
    leisureSeconds: 0,
    gatesShown: 143,
    gatesPassed: 22,
    refusals: 121,
    violations: 26,
    rulesCreated: 7,
    rulesLoosened: 2,
    xpFromDays: 0, xpFromWeeks: 0, xpFromAchievements: 0
  },

  records: {
    best_focus_day: { value: 94, date: "2026-06-11", meta: null },
    longest_rule_run: { value: 22, date: "2026-07-01", meta: { domain: "youtube.com" } }
  },

  achievements: {
    clean_week: { at: "2026-05-16", ts: 1747... }
  },

  days:   [ DayRecord, ... ],   // rolling, newest last, max 400
  weeks:  [ WeekRecord, ... ],  // rolling, max 120
  months: [ MonthRecord, ... ], // kept indefinitely (~12/year, negligible)

  settlement: {
    lastSettledDate: "2026-07-27",  // last day fully settled
    lastRunAt: 1753...,
    lastWeekSettled: "2026-W30"
  },

  today: {                        // live counters for the in-progress day
    date: "2026-07-28",
    gatesShown: { "youtube.com": 2 },
    gatesPassed: { "youtube.com": 0 }
  },

  config: {
    leisureCeilingMinutes: 60,     // C2 threshold, user-adjustable 15–240
    focusTarget: 60,               // C3 threshold, user-adjustable 40–90
    minTrackedMinutesForFocus: 30  // below this, C3 is waived. Not user-facing.
  }
}
```

### 3.2 `DayRecord`

Short keys are deliberate: 400 records live in storage permanently.

```js
{
  d: "2026-07-27",   // date key
  t: 8460,           // tracked seconds
  p: 5400,           // productive seconds
  g: 1800,           // general seconds
  l: 1260,           // leisure seconds
  f: 74,             // focus score, frozen at settlement (invariant I3)
  c1: 1, c2: 1, c3: 1,
  h: 1,              // held
  a: 0,              // absent day
  v: 0,              // violations
  gs: 2, gp: 0,      // gates shown / passed
  r: 2,              // refusals credited (after caps)
  ar: 3,             // active rules that day
  xp: 105,           // XP awarded for this day
  st: 14             // discipline streak value after this day
}
```

≈130 bytes as JSON. 400 days ≈ 52KB. Well inside the ~10MB local quota — and the
reason I2 exists, since it would be a third of the entire sync quota.

### 3.3 `WeekRecord` / `MonthRecord`

```js
{ w: "2026-W30", held: 6, recorded: 7, t: 0, p: 0, l: 0, f: 71, xp: 110, tier: 6 }
{ m: "2026-07",  held: 24, recorded: 29, t: 0, p: 0, l: 0, f: 68, xp: 3120, refusals: 41 }
```

Week keys use ISO-8601 weeks (Monday start). `progression-model.js` owns
`isoWeekKey(date)` — do not use a naive `floor(dayOfYear/7)`.

### 3.4 Event envelope

```js
{ type: "gate_shown" | "gate_passed" | "rule_created" | "rule_deleted" | "rule_loosened",
  domain: "youtube.com",
  reason: "limit" | "restraint" | "blocked",   // gate events only
  at: 1753...  }
```

Events mutate only `state.today` (gate counters) or `lifetime` counters
(rule events). They never award XP directly — XP is always a settlement product.
This keeps the economy auditable: every XP in the ledger is attributable to a
`DayRecord`, a `WeekRecord` or an achievement.

---

## 4. Pipelines

### 4.1 XP calculation pipeline

Runs once per day, inside `settleDay(dayKey)`. Five stages, each pure:

```
sites + today counters
   │
   ├─1─▶ buildDaySnapshot(sites, dayKey, gateCounters)      [engine, reads common.js]
   │        totals, per-macro seconds, focus score, violations, gates
   │
   ├─2─▶ evaluateConditions(snapshot, config)               [model, pure]
   │        { c1, c2, c3, held, absent, waivedFocus }
   │
   ├─3─▶ advanceStreak(streakState, conditions, dayKey)     [model, pure]
   │        { current, best, broken, brokenFrom, ... }
   │
   ├─4─▶ computeDayXp(conditions, snapshot, streakAfter)    [model, pure]
   │        [{ source: "adherence", xp: 25 }, ...] → total
   │
   └─5─▶ applyXp(total)                                     [engine]
            xp += total; level = levelForXp(xp); detect level-up
```

Stage 4 is a **registry**: `DAY_XP_RULES` is an array of
`{ id, label, compute(ctx) -> number }`. Adding an XP source later means pushing
one entry, and the UI can render the per-source breakdown for free (product tenet
T4 — legibility).

**`buildDaySnapshot` detail.** For each domain in `sites`:
- `seconds = usageSecondsForDate(entry, dayKey, dayKey)` — correct only after the
  audit §6.1 fix; passing `dayKey` as both arguments is what the existing
  analytics functions already do internally.
- `entryCategorySegments(domain, entry, dayKey, sites, seconds)` → accumulate
  productive / general / leisure seconds. This routes through the YouTube content
  service automatically, so a day of lectures counts as productive without the
  progression code knowing YouTube exists.
- Violation check, per domain, only when `getActiveRule` says the rule applied and
  the entry is not paused:
  - `mode === "limit"` and `isScheduleDay(entry, date)` and
    `seconds > limitMinutesForDate(entry, date) * 60 + VIOLATION_TOLERANCE_SECONDS` (30s,
    absorbing tick granularity) → violation.
  - `mode === "restraint" | "block"` and `gatesPassed[domain] > 0` → violation.
    (Do **not** use `timesTripped` — audit §6.4.)
- Focus score: `calculateFocusScore(sites, dayKey)`.
- Active-rule count for the day.

**Refusals.** `refusals = Σ_domain min(max(gs[d] − gp[d], 0), REFUSAL_MAX_PER_DOMAIN_PER_DAY)`,
then XP capped at `XP_REFUSAL_DAILY_CAP`.

**Absent day.** `t === 0 && gs === 0` → `absent: true`, XP 0, streak untouched,
`daysTracked` not incremented, `h: 0`, `a: 1`. The grid renders it neutral.

### 4.2 Streak calculation

`advanceStreak` is pure and handles four cases:

| Day outcome | Effect |
|---|---|
| absent | no change to `current`; `lastHeldDate` untouched |
| held | `current++`; if `current > best`, update `best`/`bestStart`/`bestEnd`; `lastHeldDate = dayKey` |
| not held, `current > 0` | `lastBrokenFrom = current`; `current = 0`; `currentStart = null` |
| not held, `current === 0` | no change |

Because settlement walks days strictly in order and never revisits one (I3), the
streak is a simple fold — there is no need to recompute it from `days[]`, and it
stays correct even when `days[]` is pruned at 400.

Per-rule streaks fold the same way, but only over days where
`isScheduleDay(entry, date)` was true — preserving the existing product rule that
off-schedule days neither extend nor break a run (`limitStreakDays` line 488).
Rules whose domain no longer exists in `sites` are dropped from `streaks.rules`
during pruning.

### 4.3 Update flow

```
┌── event sources ─────────────────────────────────────────────┐
│ tick() trips a rule        → navigateAfterTrip()             │
│ GRANT_RESTRAINT_PASS msg   → pass granted                    │
│ options.js rule save/delete → PROGRESSION_EVENT message      │
└───────────────┬──────────────────────────────────────────────┘
                ▼
   engine.recordEvent(type, payload)      [worker only]
                │  mutates state.today / lifetime
                ▼
   store.scheduleSave()  — debounced 2000ms, flushed before settlement
                │
┌───────────────┴── settlement triggers ───────────────────────┐
│ worker startup                                                │
│ alarm "stoic-progression-settle", every 30 min                │
│ tick() where ensureReset() returned true (day rollover)       │
│ explicit REQUEST_SETTLEMENT message from a UI surface         │
└───────────────┬──────────────────────────────────────────────┘
                ▼
   runSettlement = createCoalescingRunner(settleThrough)   ← reuse from background-logic.js
                │
                ▼
   settleThrough(todayKey):
     load state + sites
     cursor = lastSettledDate + 1  (or sites-derived first day on cold start)
     while cursor < todayKey and iterations < MAX_CATCHUP_DAYS (400):
        settleDay(cursor)
        if cursor is a Sunday → settleWeek(isoWeekKey(cursor))
        if cursor is a month end → settleMonth(...)
        cursor = cursor + 1
     if state.today.date !== todayKey → reset today counters
     prune days>400 / weeks>120, drop dead rule streaks
     save (immediate, not debounced)
                │
                ▼
   chrome.storage.onChanged fires → popup/options re-render
```

`settleDay` order matters and must not be rearranged:
`snapshot → conditions → streak → day XP → append DayRecord → lifetime counters →
records → achievements → apply XP → advance lastSettledDate`.
Achievements are evaluated **after** streaks and lifetime counters are updated so
that a predicate reading `streaks.discipline.current` sees the value including
the day just settled.

**Cold start.** On first ever run, `lastSettledDate` is null. Seed it from the
earliest date available in `sites` (`min` over `history[].date` and `lastReset`),
clamped to 7 days back. Those 6 historical days are the only ones that can ever be
back-filled; everything after is recorded forward.

**Missing settlement.** If the browser is closed for weeks, the catch-up loop
settles each intervening day. They will be absent days (no data), so they cost
nothing and pause the streak — the T6 behaviour, achieved for free.

### 4.4 Achievement evaluation

`ACHIEVEMENTS` is an array of:

```js
{ id: "clean_month",
  name: "Clean Month",
  kind: "streak",
  xp: 200,
  criterion: "Hold the daily standard 30 days in a row",   // shown while locked (T4)
  progress: (ctx) => ({ current: ctx.streaks.discipline.current, target: 30 }),
  test: (ctx) => ctx.streaks.discipline.current >= 30 }
```

`ctx` is `{ state, day, days, weeks, months, streaks, lifetime, sites }` — the
post-update state plus the day just settled. The pass is:

```js
for (const def of ACHIEVEMENTS) {
  if (state.achievements[def.id]) continue;      // one-shot, irrevocable (T2)
  if (def.test(ctx)) { award(def); }
}
```

O(27) per day. `progress()` is optional and exists so locked achievements can
render a progress bar instead of a bare lock.

Predicates that need a window (`quiet_week`, `deep_week`, `downward_trend`) read
the tail of `days[]` / `weeks[]`. Model helpers: `lastNDays(days, n)`,
`consecutiveFrom(days, predicate)`.

### 4.5 Record evaluation

```js
{ id: "best_focus_day",
  label: "Best focus score",
  direction: "max",
  qualifies: (day) => day.t >= 3600,
  extract: (day) => day.f,
  meta: null }
```

Day-scoped records evaluate on each settled day; week- and month-scoped ones on
their respective rollups (`scope: "day" | "week" | "month" | "state"`).
`longest_streak` and `longest_rule_run` have `scope: "state"` and read the streak
block directly.

---

## 5. Integration with existing code

Six touch points. Each is small and additive.

| File | Change | Risk |
|---|---|---|
| `common.js` | Fix `usageSecondsForDate` (audit §6.1). Export `MACRO_ORDER`-based helper `macroSecondsForDay(sites, dayKey)` if the engine wants it, or keep that in the engine. Add nothing else. | Low — one condition, covered by a new test |
| `background.js` | `importScripts` three files; emit `gate_shown` in `navigateAfterTrip`; emit `gate_passed` in the `GRANT_RESTRAINT_PASS` handler; create the settle alarm; call `runSettlement()` when `ensureReset` returns true; handle `PROGRESSION_EVENT` and `REQUEST_SETTLEMENT` messages | Low — additive, no change to tracking logic |
| `manifest.json` | Add the four new files to `web_accessible_resources` | None |
| `popup.html/js/css` | Load model+store+ui; render the strip | Low |
| `options.html/js/css` | New nav tab + panel; render sections; two config fields in Preferences; include `progression` in export/import | Medium — largest surface, but isolated in a new panel |
| `blocked.html/js` | Load model+store; add one stat cell on the restraint path | Low |

**Analytics reuse is total.** The engine calls `calculateFocusScore`,
`entryCategorySegments`, `getActiveRule`, `isScheduleDay`, `limitMinutesForDate`,
`usageSecondsForDate`, `dateKey`, `addDays`. It reimplements none of them. A
future change to the focus formula or to the category taxonomy flows into future
days automatically and, by I3, leaves settled history untouched.

**`limitStreakDays` is not deleted in this project.** Once per-rule streaks are in
the ledger, the two "Rule Adherence Streaks" call sites in `options.js` can be
repointed at `state.streaks.rules[domain]` with an `|| limitStreakDays(entry)`
fallback for domains with no ledger history yet. That is the whole migration.

---

## 6. Future extensibility

The registries are the extension surface. Adding each of the following requires
no change to the engine:

- **A new XP source** → push to `DAY_XP_RULES`. It appears in the settlement
  breakdown UI automatically.
- **A new achievement** → push to `ACHIEVEMENTS`. It evaluates from the next
  settlement onward, and against existing history if its predicate reads
  `days[]`/`lifetime` — retroactive by construction.
- **A new record** → push to `RECORDS`.
- **A new day condition (C4)** → the conditions object is a map, not three named
  booleans; `held` is `every(condition => met)`. Adding one means adding a
  definition and a threshold to `config`, plus a migration bump.
- **A new event type** → add to the envelope union and a handler branch in
  `recordEvent`. Events are already routed generically through one message type.
- **Per-category goals, custom user goals, seasons** — deliberately not built
  (product doc §3.11, §3.9), but the `config` block and the condition registry are
  where they would go if that decision is ever revisited.

**Schema migration.** `store.migrate(state)` switches on `state.version` and
applies ordered migrations. Because settled days are immutable, a migration must
never recompute a `DayRecord` — it may only add fields with defaults. Bump
`PROGRESSION_SCHEMA_VERSION` on any shape change.

---

## 7. UI structure

Markup follows the existing conventions exactly: `.card` / `.card-secondary`
wrappers, `.section-title`, `.nav-tab` + `.tab-panel` for the new tab,
`tokens.css` semantic colours, no new fonts, no new colour values.

```
options.html
└── nav: [Overview] [Progress] ← new, position 2 … 
└── section#tab-progress
    ├── .prog-identity            level ring · rank · descriptor · XP bar · "N XP to Level M"
    ├── .prog-standing            three .prog-condition chips (met / unmet / waived)
    ├── .prog-streaks             current · best · per-rule list
    ├── .prog-grid                365-cell contribution grid + legend
    ├── .prog-records             8 record tiles
    ├── .prog-achievements        earned grid, then locked grid with criteria + progress
    └── .prog-lifetime            stat grid

popup.html
└── .prog-strip  (below hero, above Top Websites)
    level · rank · xp bar · ●●● today · streak

blocked.html (restraint only)
└── one extra .stat-cell: "Turned back" / N
```

`progression-ui.js` exposes one render function per block, each taking
`(state, options)` and returning an HTML string. `options.js` and `popup.js`
call them and set `innerHTML`; neither surface contains progression markup logic.
This is what stops the two from drifting, and it is why `options.js` does not grow
by another 600 lines.

**Colour mapping** (all existing tokens): held → `--sem-green`, partial →
`--sem-amber`, missed → `--sem-red-dim`, absent → `--border-soft`, level ring →
`--accent`. Both themes work with no new declarations because the tokens already
resolve per theme.

---

## 8. Testing strategy

`node --test`, same as the existing suite, `require()` against source files.

**`test/progression-model.test.js`** — the bulk. Pure functions, no mocks:
level curve boundaries, rank mapping, `evaluateConditions` including the focus
waiver and the vacuous-adherence case, `computeDayXp` including all caps,
`advanceStreak` across all four transitions, `isoWeekKey` across year boundaries,
every achievement predicate against hand-built fixtures, record comparators
including the qualifier guards.

**`test/progression-engine.test.js`** — engine with a fake store and a fixture
`sites` map: `buildDaySnapshot` totals and violation detection, `settleThrough`
idempotence (running twice changes nothing), multi-day catch-up, absent-day
handling, cold start.

**`test/common.test.js`** — one added case: `usageSecondsForDate` returns
`usedSeconds` for a past `lastReset` that has not yet been archived (audit §6.1).

Not unit-tested: `progression-ui.js` (markup), `progression-store.js` chrome
bindings. Both are verified manually per the checklist in the spec.
</content>
</invoke>
