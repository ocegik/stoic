# Progression System — Implementation Handoff

For whoever (or whatever) implements this. The four design docs are the complete
source of truth; no other context is required.

---

## How to run the work

Do **one phase per session**. Each phase ends with `npm test` green and the
extension still loading, so a session that runs out of context can be resumed
cleanly at the next phase boundary.

Do **not** hand over all eight phases at once. Phases 1 and 3 are each a
~500-line file with exact required semantics; attention degrades across that much
output and the failures are silent (a wrong streak transition or a missed cap
does not throw — it just quietly produces wrong numbers for months).

### Kickoff prompt — use this verbatim at the start of every session

> Read `docs/progression/00-AUDIT.md`, `01-PRODUCT-DESIGN.md`,
> `02-ARCHITECTURE.md` and `03-IMPLEMENTATION-SPEC.md` in full before writing any
> code. Then implement **Phase N only** from the implementation spec. Do not start
> later phases. Do not change the constants, thresholds, XP values, achievement
> list or data shapes — they are decided; if something seems wrong, say so and
> stop rather than substituting your own value. Follow the house rules in the
> spec preamble: classic scripts, no imports, no npm dependencies, `module.exports`
> tail. When the phase is done, run `npm test`, then update
> `docs/progression/HANDOFF.md`'s checklist below.

Replace **N** each session. For UI phases add: "Match the existing visual
language — read `tokens.css`, `components.css` and `options.css` first, and use
only tokens that already exist."

### Session plan

| Session | Phases    | Notes                                                                                                                                                                                                          |
| ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | 0 + 1     | Precondition fix, then `progression-model.js`. **Write `test/progression-model.test.js` in this same session**, not in Phase 7 — the model is pure and untested arithmetic here poisons everything downstream. |
| 2       | 2 + 3     | Store, then engine. Write `test/progression-engine.test.js` here too.                                                                                                                                          |
| 3       | 4         | `background.js` wiring. Small; verify by hand that the extension still loads and ticks.                                                                                                                        |
| 4       | 5         | `progression-ui.js` + `progression.css`. Pure markup, no behaviour.                                                                                                                                            |
| 5       | 6.1 + 6.4 | Popup strip + manifest. Smallest surface first — proves the whole chain end to end.                                                                                                                            |
| 6       | 6.2       | Options Progress tab, Preferences fields, export/import. Largest UI phase; give it its own session.                                                                                                            |
| 7       | 6.3       | Blocked page line.                                                                                                                                                                                             |
| 8       | 7         | Fill any test gaps, then run the manual verification checklist.                                                                                                                                                |

Phase 7's test list is the _acceptance bar_, not the place to start testing.
Tests for a phase belong in that phase's session.

---

## Checklist — update as you go

- [x] **Phase 0** — `usageSecondsForDate` fix + `test/common.test.js` case
- [x] **Phase 1** — `progression-model.js` + `test/progression-model.test.js`
- [x] **Phase 2** — `progression-store.js`
- [x] **Phase 3** — `progression-engine.js` + `test/progression-engine.test.js`
- [x] **Phase 4** — `background.js` wiring (importScripts, 2 events, alarm, messages)
- [x] **Phase 5** — `progression-ui.js` + `progression.css`
- [x] **Phase 6.1** — popup strip + level-up banner
- [x] **Phase 6.4** — `manifest.json` (web_accessible_resources, version 2.3.0)
- [x] **Phase 6.2** — options Progress tab + Preferences fields + export/import
- [x] **Phase 6.3** — blocked page "Turned back" cell
- [x] **Phase 7** — test gaps closed, manual checklist run (to the extent the sandbox allows — see note)

**Note on Session 8 (Phase 7).** `npm test` is green, **215/215** (up from 193;
22 new cases, no existing test touched or weakened). What was added, and why
each was a real gap rather than busywork:

- `test/progression-store.test.js` (new file, 14 cases). The architecture doc
  explicitly excludes `progression-store.js`'s "chrome bindings" from the unit
  test bar and defers them to this checklist — but `defaultProgressionState()`
  and `migrateProgressionState()` are pure data-shaping with no `chrome.*`
  calls, and the I1/I2 write guards (`saveProgression` refusing to write
  outside a service-worker context, `chrome.storage.local` used
  unconditionally) are cheap to exercise with a mocked `global.chrome`/
  `global.importScripts`, the same pattern `test/common.test.js` already uses
  for `setThemePreference`. Covers: default shape, migration from
  null/undefined/garbage, forced schema version, byte-for-byte passthrough of
  `days`/`weeks`/`months` (I3), corrupt-array coercion to `[]`, nested-section
  merging for a partial prior shape, `today` fallback vs. preservation, the
  Node fallback path `loadProgression`/`getProgressionSync` use when
  `chrome.storage` is absent, the I1 write guard in both directions, and
  `sendProgressionEvent`'s message shape and error-swallowing.
- `test/progression-engine.test.js`: 4 cases for `applyEvent`'s `level_up_seen`
  and `config_updated` branches. These two event types were added in Sessions
  5-7 beyond the original architecture doc (see the note below) and had zero
  test coverage — exactly the kind of silent-wrong-number risk the spec's
  "things easy to get wrong" section warns about. Covers: the dismiss flag
  flipping without touching `level.xp`/`level.level` (T2), the no-pending-
  level-up no-op, config fields applying independently and cumulatively, and
  non-numeric/missing payload fields being ignored rather than corrupting
  `state.config`.
- **A real gap, fixed, not just tested.** Session 5-7's own note (below)
  said `lifetime.refusalsByDomain` would be "cap[ped] to the 50 most-refused
  domains during pruning" — this is in `03-IMPLEMENTATION-SPEC.md` §6.3, not
  an invented requirement. It was never actually implemented: `settleThroughState`
  pruned `days`/`weeks`/dead rule streaks but had no code touching
  `refusalsByDomain` at all, so that map would have grown by one key per
  distinct domain ever visited, forever. Added `MAX_REFUSAL_DOMAINS = 50` next
  to the other retention constants in `progression-model.js` (§1.1's existing
  block — this is the same class of constant, not a new kind of tuning knob),
  and a pruning step in `progression-engine.js` right after the existing
  `days`/`weeks`/rule-streak pruning that keeps only the 50 highest-count
  domains. 4 new tests cover the over-cap case (keeps the highest, by count,
  not by recency), the at-or-under-cap no-op case, and integrate with the
  existing days/weeks pruning tests (which is itself a gap this session
  closed — there was previously no test at all for the `MAX_LEDGER_DAYS`/
  `MAX_LEDGER_WEEKS` pruning, only for the streak/rule-domain half of it).
  This is a completion of an already-specified, already-documented detail,
  not a redesign — flagging it here rather than silently fixing it, per the
  instruction to stop and explain rather than invent when something looks
  wrong; happy to revert if a different cap or eviction policy (e.g.
  least-recently-refused instead of least-refused) was actually intended.
- Re-verified, not just trusted: syntax-checked all eleven JS files fresh;
  re-ran the script/link → file and `getElementById` → static-`id` resolution
  checks across `popup`/`options`/`blocked` (still clean, same handful of
  `blocked.js`-injected restraint-widget ids as before); grepped every
  progression file for `chrome.storage.sync` (none) and `chrome.notifications`
  (none — the one hit in `background.js` is the pre-existing 80/90% limit
  warning, untouched); confirmed every CSS custom property `progression.css`/
  `progression-ui.js` reference resolves in `tokens.css`, and that the
  color-carrying ones have both a light and a dark definition (the handful
  that don't — `--mono`, `--radius-xs`, `--radius-md`, `--space-3/4/6` — are
  theme-independent structural tokens defined once in `:root`, not colors, so
  that's correct, not a gap); confirmed `progression-store.js` always writes
  `chrome.storage.local` unconditionally, decoupled from `getStorageArea()`/
  `storagePreference` entirely (checklist item 5, statically provable);
  confirmed the export/import restore path (`options.js` → `RESTORE_PROGRESSION`
  → `migrateProgressionState` + `saveProgression`) is version-gated exactly as
  §6.2 specifies and is now covered by the migration tests above.
- **The manual verification checklist's items 1-4 and 6 are, in their literal
  form ("load unpacked", "browse a few sites", "close the browser for two
  days"), still not runnable in this sandbox.** Re-attempted this session,
  differently from before: headless and headful Google Chrome 150 with
  `--load-extension`, `--remote-debugging-port` + `--remote-allow-origins=*`
  for CDP inspection. The flag is silently accepted (no error this time, not
  even the "not allowed... ignoring" line the Session 3+4 report saw) but the
  extension never actually loads — every `/json/list` target after launch is
  a stock Chrome component extension (Google Hangouts, Chrome Web Store
  Payments, Google Docs Offline), confirmed by evaluating in the "service
  worker" target found each time: `chrome.runtime.getManifest().name` came
  back `"Google Docs Offline"`, not Stoic. This is the same wall the last two
  sessions hit, now confirmed from a third angle (CDP-level, not just process
  exit codes) — it is a Chrome policy on this build, not a flag typo or a
  sandboxing artifact this session introduced. What *is* covered, as an
  honest substitute: every piece of logic those checklist items exercise
  (fresh-state Level 1, limit-violation → C1 fail → refusal, restraint-pass →
  violation, absence pausing a streak, version-gated restore) has direct
  engine/model/store-level test coverage now, which is as close to those
  scenarios as `node --test` can get without a real browser. **Whoever next
  has a machine where "Load unpacked" actually opens should still do the
  literal walkthrough once** — nothing here substitutes for that, it only
  narrows what could possibly be wrong when they do.

**Note on Session 5-7 (Phases 6.1-6.4).** `npm test` is green (193/193,
unchanged — this was a UI-wiring session, no new pure logic beyond two small
`recordEvent` branches, see below). All new HTML/script references were
verified statically: every `<script src>`/`<link href>` in `popup.html`,
`options.html` and `blocked.html` resolves to a real file; every
`getElementById` call in `popup.js`/`options.js`/`blocked.js` has a matching
static `id=` in its HTML (the handful of misses are ids `blocked.js` itself
injects via `innerHTML` for the restraint widget, not missing markup); `node
-c` syntax-checks clean on all five touched JS files; every progression CSS
token used already exists in `tokens.css` for both themes.

Loading the unpacked extension in real Chrome (`chrome://extensions`) was
attempted again this session — via CLI (`--load-extension`, both headless
and headed, with `--remote-debugging-port` to inspect targets via CDP) —
and still fails the same way the Session 3+4 report described, but with the
exact reason now confirmed in the log: `--load-extension is not allowed in
Google Chrome, ignoring.` This is a branded-Chrome policy check, not a
sandbox/accessibility limitation, and it can only be lifted by an enterprise
policy (e.g. `ExtensionInstallSources`/an allow-list pushed via
`com.google.Chrome.plist`) or by using Chromium instead of Google Chrome —
neither of which this session did, since both are a system-level
configuration change beyond what a code-review pass should make
unilaterally. **Whoever has a machine that can actually open
`chrome://extensions` → "Load unpacked" should do that check once** — it is
the one thing this and the prior session could not do. Two new
`PROGRESSION_EVENT` types were added beyond what Sessions 1-4 built,
because Phases 6.1 and 6.2 explicitly call for them:
- `level_up_seen` — dismisses the level-up banner (`03-IMPLEMENTATION-SPEC.md`
  §6.1: "Dismiss sends `PROGRESSION_EVENT` with type `level_up_seen`").
- `config_updated` — writes the two Daily Standard fields
  (§6.2: "send `PROGRESSION_EVENT` `config_updated` with the clamped
  values"). Clamping (15-240 / 40-90) happens in `options.js` before the
  event is sent; `recordEvent` just writes what it's given, same as every
  other event.

One more addition beyond the two event types: restoring `progression` from
an export/import backup is a whole-state replacement, not an incremental
event, so it doesn't fit the `recordEvent`/`PROGRESSION_EVENT` shape at all.
The spec says *what* to do ("restore it only when `payload.progression?.version`
is a supported schema version... replace or skip, never merge") but not the
transport. Added a new message type, `RESTORE_PROGRESSION` (`background.js`),
that hands the raw imported state straight to the existing
`migrateProgressionState` + `saveProgression` — still worker-only (I1), still
zero new engine logic, just a second entry point into the same store
functions `recordEvent` already uses.

**Note on Phase 4/5 verification.** `npm test` is green (193/193) and every file
syntax-checks. `background.js`'s wiring was verified statically (all
`importScripts` targets exist, `recordEvent`/`settleThrough`/`runSettlement`
resolve, message handlers follow the existing async-response convention) —
loading it interactively in `chrome://extensions` was not possible in the
sandbox this session ran in (recent Chrome versions ignore the
`--load-extension` command-line flag outside enterprise policy, and no OS
accessibility permission was available to drive the native "Load unpacked"
folder picker). But check again user might give permission manually, ask him. `progression-ui.js`'s render functions were smoke-tested under
Node with fixture state/sites data (see the Session 3+4 report) rather than
opened in a real popup/options page. Whoever runs Phase 6 should do the actual
"load unpacked, open the popup" check once these functions are wired into a
surface — nothing before Phase 6.1 renders anything on screen.

---

## Guardrails — repeat these if the implementer drifts

These are the failure modes worth pre-empting. Each one produces data that is
wrong but not obviously wrong, and by the time it shows up the ledger is already
corrupted.

1. **Never settle the current day.** The catch-up loop condition is
   `cursor < todayKey`, strictly.
2. **Never subtract from `level.xp`.** No decay, no penalties, no recalculation.
3. **Never re-award or revoke an achievement.** One-shot, permanent.
4. **Never recompute streaks from `days[]`.** They are folded forward into
   `state.streaks`; that is precisely what makes pruning at 400 days safe.
5. **Never write progression state to `chrome.storage.sync`.**
6. **Never call `chrome.notifications` from progression code.**
7. **Never use `entry.timesTripped`** for anything day-scoped — it is all-time.
8. **Absent ≠ missed.** Different colour, different streak behaviour.
9. **Only the service worker writes.** Pages send messages.
10. **Prime the YouTube stores once per settlement run** or productive watch time
    settles as leisure.

## If the implementer wants to change something

Constants, thresholds, the achievement list, the level curve and the data shapes
are product decisions with reasons recorded in `01-PRODUCT-DESIGN.md`. If a
change looks necessary, the right move is to stop and flag it — most apparent
problems are answered in the rejected-mechanics section (§3) or in the
architecture invariants (§1), and a change made locally will contradict a
downstream phase.
</content>
</invoke>
