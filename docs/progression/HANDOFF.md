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

| Session | Phases | Notes |
|---|---|---|
| 1 | 0 + 1 | Precondition fix, then `progression-model.js`. **Write `test/progression-model.test.js` in this same session**, not in Phase 7 — the model is pure and untested arithmetic here poisons everything downstream. |
| 2 | 2 + 3 | Store, then engine. Write `test/progression-engine.test.js` here too. |
| 3 | 4 | `background.js` wiring. Small; verify by hand that the extension still loads and ticks. |
| 4 | 5 | `progression-ui.js` + `progression.css`. Pure markup, no behaviour. |
| 5 | 6.1 + 6.4 | Popup strip + manifest. Smallest surface first — proves the whole chain end to end. |
| 6 | 6.2 | Options Progress tab, Preferences fields, export/import. Largest UI phase; give it its own session. |
| 7 | 6.3 | Blocked page line. |
| 8 | 7 | Fill any test gaps, then run the manual verification checklist. |

Phase 7's test list is the *acceptance bar*, not the place to start testing.
Tests for a phase belong in that phase's session.

---

## Checklist — update as you go

- [x] **Phase 0** — `usageSecondsForDate` fix + `test/common.test.js` case
- [x] **Phase 1** — `progression-model.js` + `test/progression-model.test.js`
- [ ] **Phase 2** — `progression-store.js`
- [ ] **Phase 3** — `progression-engine.js` + `test/progression-engine.test.js`
- [ ] **Phase 4** — `background.js` wiring (importScripts, 2 events, alarm, messages)
- [ ] **Phase 5** — `progression-ui.js` + `progression.css`
- [ ] **Phase 6.1** — popup strip + level-up banner
- [ ] **Phase 6.4** — `manifest.json` (web_accessible_resources, version 2.3.0)
- [ ] **Phase 6.2** — options Progress tab + Preferences fields + export/import
- [ ] **Phase 6.3** — blocked page "Turned back" cell
- [ ] **Phase 7** — test gaps closed, manual checklist run

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
