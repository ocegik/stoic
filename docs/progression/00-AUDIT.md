# Progression System — Codebase Audit

Status: complete. This document is the factual basis for every design decision in
`01-PRODUCT-DESIGN.md` and `02-ARCHITECTURE.md`. Read it first.

---

## 1. How the extension is organised today

| File | Lines | Role |
|---|---|---|
| `common.js` | 1859 | Shared kernel: date helpers, storage-area abstraction, schedule logic, restraint gate primitives, the category taxonomy, the whole classification framework, and **all analytics functions**. Loaded as a classic script by every surface and via `importScripts` in the worker. Also `require()`-able from Node — this is what makes it testable. |
| `background.js` | 395 | Service worker. Owns `tick()` — the single read-modify-write cycle that credits time, fires warnings, and trips rules. Owns all Chrome event listeners and the message router. |
| `background-logic.js` | 197 | Pure, chrome-free logic extracted from `background.js` purely so it can be unit-tested (`ensureReset`, `matchSite`, `clampElapsed`, `crossedThreshold`, `createCoalescingRunner`). **This is the architectural pattern to copy.** |
| `youtube-classifier.js` | 1490 | Platform domain service. Registers itself into `common.js` via `registerClassifierRule` / `registerContentService`. One-directional dependency. |
| `options.js` / `options.html` | 1516 / 694 | The dashboard: 7 tabs (Overview, Detailed Analysis, Categories, Rules, YouTube & Debugger, Preferences, Backup). |
| `popup.js` / `popup.html` | 266 / 153 | Quick glance: today's total, focus gauge, top 3 sites, moderation counters, classification debugger. |
| `blocked.js` / `blocked.html` | 363 / 96 | The reality-check page and the restraint friction gate. |
| `tokens.css`, `components.css` | 299 / 365 | Design tokens (light/dark) and shared components. |
| `test/*.test.js` | 9 files | `node --test`, plain `node:assert/strict`, `require()` against the source files directly. No build step, no framework. |

Load order everywhere is `common.js` → `youtube-classifier.js` → surface script.
No modules, no bundler, no framework. Everything is globals + a CommonJS export
tail. **Any new file must follow the same convention.**

---

## 2. Behavioural data that already exists

All of it lives in one map, `sites`, keyed by domain:

```js
sites["youtube.com"] = {
  mode: "limit" | "block" | "restraint" | "unconstrained",
  limitMinutes: 30,
  usedSeconds: 4210,             // today only
  lastReset: "2026-07-27",
  history: [{ date, seconds, youtube? }],   // MAX_HISTORY_DAYS = 6
  action: "page" | "redirect",
  redirectUrl: "",
  paused: false,
  schedule: { days: [0..6], startTime, endTime, dayLimits: {} },
  timesTripped: 12,              // ALL-TIME, never day-scoped
  lastTrippedAt: 1753...,
  notified80: false, notified90: false,
  createdAt: "2026-06-01",
  youtube: { date, keys: { "v:<id>": seconds } },   // per-content attribution
  microCategory / macroCategory / category,          // user override
}
```

Crucial detail: `tick()` **auto-creates an entry for every domain the user
visits**, with `mode: "unconstrained"`. `sites` is therefore not a rules table —
it is a complete browsing-time ledger for the last 7 days. The progression system
can read a real picture of the user's day from it without adding any tracking.

### What is measured accurately
- Foreground, focused-window time only, from real elapsed deltas, clamped to
  `MAX_ELAPSED_SECONDS = 60` per tick (`clampElapsed`). Sleep/wake cannot inflate it.
- Per-video / per-channel YouTube attribution, resolved to a category at **read**
  time, so re-classification retroactively corrects the current day.

---

## 3. Analytics that already exist (all in `common.js`)

| Function | Returns | Reusable for progression? |
|---|---|---|
| `usageSecondsForDate(entry, key, today)` | seconds for one day | Yes — **with one bug fix**, see §6.1 |
| `trailingWeekUsage(entry, today)` | 7 day-cells with `scheduled` + `limitMinutes` | Yes |
| `limitStreakDays(entry, today)` | consecutive in-limit days | **Capped at 7** by the history window. Superseded. |
| `getTopSitesToday(sites, today)` | ranked domains + `pctOfTotal` | Yes |
| `entryCategorySegments(domain, entry, dayKey, sites, secs)` | `[{macro, micro, seconds, sources}]` | **Yes — the single most valuable reuse.** Already day-keyed, already handles archived days, already routes through content services. |
| `getCategoryBreakdown(sites, today)` | macro + micro totals & percentages | Today-only in signature, but day-keyed internally |
| `getBrowsingStats(sites, today)` | totals, top websites, breakdown | Today-only |
| `calculateFocusScore(sites, today)` | `Productive% − Leisure%×0.25`, clamped 0–100 | Yes |
| `getFocusScoreTheme(score)` | label + colour + class | Yes, for UI |
| `getDailyComparison`, `generateQuickInsight` | copy strings | Not needed |
| `getModerationStats(sites, today)` | rule counters | **Do not build on it** — see §6.2 |
| `getDomainTaxonomy` / `getCategoryFocusWeight` / `MACRO_CATEGORIES` | taxonomy | Yes |
| `fmtMinutes`, `fmtDuration`, `dateKey`, `addDays`, `dateFromKey` | formatting/date | Yes |

Note `getCategoryBreakdown`, `getBrowsingStats` and `calculateFocusScore` all take
a `today` argument that is really a *day key*, and internally call
`usageSecondsForDate(entry, today, today)` — passing the same key as both
arguments. That is what makes them work for arbitrary past days **once the reader
bug in §6.1 is fixed**.

---

## 4. Events that already exist

| Source | Signal it carries | Currently used for |
|---|---|---|
| `tick()` every 5–30s | active domain, credited seconds | usage accounting |
| `ensureReset(entry)` returns `true` | **day rollover for that entry** | archiving into `history` |
| `crossedThreshold` | 80% / 90% of a limit | notifications |
| `tripReason` in `tick()` | `"limit"` \| `"blocked"` \| `"restraint"` — the moment a user is stopped | `timesTripped++`, navigate to `blocked.html` |
| `navigateAfterTrip()` | **the gate was shown for domain X** | navigation only — not recorded |
| `GRANT_RESTRAINT_PASS` message | **the user completed the 60s + 2 puzzles + written reason gate and pushed through** | granting the pass — not recorded |
| `requestFrictionGate()` in options.js | user loosened/deleted a restraint or block | confirmation only — not recorded |
| `chrome.tabs.onRemoved` / `onUpdated` / `windows.onFocusChanged` | tab lifecycle | re-tick, pass cleanup |
| `chrome.storage.onChanged` | cross-context state sync | re-render (popup + options already do this) |

Two of these — *gate shown* and *gate passed* — are the highest-signal behavioural
events in the entire product and neither is persisted anywhere. They are free.

---

## 5. What can be reused vs. what must not be duplicated

**Reuse directly, never reimplement:**
- Category resolution and time segmentation (`entryCategorySegments`).
- Focus score math (`calculateFocusScore`) and its theme.
- Schedule semantics (`isScheduleDay`, `isWithinTimeWindow`, `limitMinutesForDate`,
  `getActiveRule`) — including the rule that **off-schedule days are not failures**.
- All date and duration formatting.
- The `registerClassifierRule` / `registerContentService` registry pattern — the
  progression system's achievement/XP/record registries should feel identical.
- `createCoalescingRunner` — for the settlement job, which has the same
  "triggered from several sources, must never run twice concurrently" shape as `tick()`.
- The `background-logic.js` split: pure logic in one file, chrome IO in another.
- UI: `.card`, `.card-secondary`, `.section-title`, `.stat`/`.perf-cell` grids,
  `.segmented`, `.nav-tab` / `.tab-panel`, the friction-gate modal, `tokens.css`
  semantic colours, and the theme system (`data-theme`, `applyTheme`).

**Must not be duplicated:**
- Anything that decides what category time belongs to.
- Anything that decides whether a rule was active on a given day.
- Time formatting.
- `limitStreakDays` — do not extend it; it is structurally capped by the 6-day
  history. Progression computes streaks from its own ledger instead, and the
  existing call sites can later be repointed.

---

## 6. Gaps, traps and pre-existing defects

### 6.1 `usageSecondsForDate` cannot read an un-rolled-over past day — **blocking**
```js
if (key === today && entry.lastReset === today) return entry.usedSeconds || 0;
```
`ensureReset` only runs for the **domain currently in the foreground**. At 00:05
on day D+1, most entries still hold day D's data in `usedSeconds` with
`lastReset === D`; they will not be archived into `history` until the user next
visits that exact domain. Settlement for day D runs on day D+1, so `key = D`,
`today = D+1`, the first condition fails, `history` has no D record, and the
function returns **0**. Every day would settle as an empty day.

Required fix (strictly more correct, backward compatible):
```js
if (entry.lastReset === key) return entry.usedSeconds || 0;
```
When `key === today === lastReset` behaviour is identical. Nothing else regresses:
`getTopSitesToday(sites, today)` still returns 0 for an entry whose `lastReset` is
a past day, and `trailingWeekUsage` starts reporting yesterday correctly instead
of zero. `attributionMapFor` in `youtube-classifier.js` already handles both
cases correctly and needs no change.

### 6.2 History is 6 days; there is no long-term data at all
`MAX_HISTORY_DAYS = 6`. There is no global daily record, no lifetime counter, no
install date (only per-site `createdAt`), and no archive of focus scores.
**Consequence: every lifetime statistic must be accumulated forward. Nothing can
be back-derived.** This single fact determines the entire storage design.

### 6.3 Day rollover is lazy and per-entry
There is no global "the day changed" event. Settlement needs its own alarm plus a
catch-up loop, and must be idempotent.

### 6.4 `getModerationStats().limitsTriggeredToday` is wrong
```js
if (entry.lastReset === today && tripped > 0) limitsTriggeredToday += tripped;
```
`tripped` is the **all-time** `timesTripped`. Any entry touched today contributes
its lifetime count. Do not use `timesTripped` for any day-scoped progression
logic; count gate events explicitly instead.

### 6.5 `sites` may live in `chrome.storage.sync`
The Preferences tab moves `sites` to `chrome.storage.sync` (quota: ~100KB total,
8KB per item). `sites` already grows without bound because every visited domain
gets an entry. **Progression state must be local-only, unconditionally**, or it
will push `sites` over the quota. This is also correct on the merits: progression
is a per-device journal of local browsing.

### 6.6 Restraint passes are ephemeral
`restraint_passes` are deleted on tab close and expire in 15 minutes. They cannot
be used to reconstruct "did the user break a restraint today". The gate-passed
event must be recorded explicitly at the moment it happens.

### 6.7 Focus score semantics just changed
Uncommitted work replaced the weighted/penalty score with
`Productive% − Leisure%×0.25`. Progression should treat the score as a stable
input **and freeze it per day at settlement**, so a future tuning of the formula
cannot retroactively rewrite recorded history.

---

## 7. Summary of what the progression system needs to add

Only three things are genuinely new; everything else is composition of what exists:

1. **A persistent, append-only daily ledger** (the 6-day history cannot serve).
2. **Two event recordings** — gate shown, gate passed — both already occurring in
   `background.js` and currently thrown away.
3. **Its own streak/level/achievement state**, because none of it is derivable.

No new tracking of user browsing. No new content scripts. No new permissions.
</content>
</invoke>
