# Stoic redesign — Session 2, in three phases

Run these as **three separate sessions**, in order, switching models between them.
Each phase ends at a hard stop. Do not start the next phase in the same session.

| Phase | Model | Work | Ends when |
|---|---|---|---|
| 1 | **Sonnet** | Deletions + Options IA 8→4 | `npm test` green, four tabs working, debugger gone |
| 2 | **Opus** | Spacing/placement/alignment system + 2–3 colour directions | Screenshots presented, **no code committed to the chosen direction** |
| 3 | **Sonnet** | Apply the chosen direction everywhere | Full verification sweep passes |

Read before any phase, do not redo:

- `docs/audit/PRODUCT-AUDIT.md` — source of truth. Do not re-audit.
- `docs/GLOSSARY.md` — binding vocabulary and copy brief.
- Session 1 shipped: Limestone/Basalt palette, 8-step type scale, self-hosted
  fonts, flat components, block-page copy fixes, popup redesign with "Limit this
  site" + first-run onboarding, tablist keyboard pattern. All of it stays.
  215 tests pass — keep them passing.

Scope for all three phases: **product design, UI, IA, design system, visual
identity, user flows, navigation, layout, components, copy.** No backend,
classification, progression logic, storage or performance work.

Out of scope entirely: R1–R3, R17, R19–R21, R24–R26.

---

# PHASE 1 — Deletions and IA — **Sonnet**

Deletions come before redesign: never restyle what you are about to delete.

1. **Delete the debugger and AI settings card** (audit R4). Remove the
   `tab-youtube-debug` panel, the live inspector, the precedence-chain trace, the
   video database table, and the AI provider / confidence-threshold /
   auto-classify card. Keep the **channel classification table** — move it under
   Rules. Keep the precedence trace as a console log behind a debug flag.
2. **Delete the dead tests** in the same pass:
   `test/ai-classification.test.js`, `test/youtube-custom-provider.test.js`, and
   any assertions in other files covering removed code paths. `npm test` must be
   green at the end.
3. **Options IA: 8 tabs → 4** (R14) — Today / Record / Rules / Settings per audit
   §3.3. The IA decision is already made; this is structural only. Tab labels and
   headings are already in the new vocabulary. Move panels **wholesale** — do not
   restyle them, Phase 2 handles composition. The roving-tabindex keyboard
   pattern in `options.js` already works; keep it working.
4. **Clear the last 18 inline `style=` attributes** in `options.html`. All are
   inside the region deleted in step 1, so they should go with it. Verify zero
   remain; use the existing `.mt-*` / `.measure` helpers if any survive.
5. **Add the "Why was this counted as X?" affordance** (R5): a small "Why?"
   control on YouTube rows in the site table and category breakdown, opening one
   plain-language sentence plus an inline "Classify this channel" action. This is
   what the debugger was actually for.

**STOP.** Report: tabs working, what was deleted, test count. Do not touch
spacing, colour or composition.

## PHASE 1 — STATUS: done

- **Tabs.** 8 → 4 (Today / Record / Rules / Settings), IDs `tab-today` /
  `tab-record` / `tab-rules` (unchanged) / `tab-settings`. Roving-tabindex
  keyboard pattern untouched, still works. `popup.js`'s "Open your record" and
  settings-gear links updated to `#tab-record` / `#tab-settings`.
- **Deleted.** The whole `tab-youtube-debug` panel: live inspector,
  precedence-chain trace UI, video database table, AI provider/confidence-
  threshold/auto-classify card — including the underlying
  `CustomAPIClassifierProvider` (`fetch()`-to-arbitrary-endpoint) and
  `getAISettings`/`saveAISettings` in `youtube-classifier.js`, and the
  `GET_CLASSIFICATION_DEBUG_INFO` handler in `background.js`. Auto-classify is
  now unconditionally on; confidence threshold is a fixed constant
  (`DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.7`) — no settings UI for either.
- **Kept.** The channel classification table, moved under Rules as "What
  counts as what on YouTube." The precedence trace, as `console.log` behind
  `YT_DEBUG_TRACE` (false by default) in `youtube-classifier.js`.
- **Tests.** `test/ai-classification.test.js` and
  `test/youtube-custom-provider.test.js` deleted (9 + 5 = 14 tests); one stale
  `saveAISettings` call removed from `youtube-integration.test.js`. 215 → 201,
  all green.
- **Inline styles.** Zero `style=` attributes remain in `options.html`.
- **R5 "Why?" affordance.** Shipped on both the domain audit table (Record
  tab) and the category breakdown, for YouTube rows only. Powered by two new
  functions in `youtube-classifier.js`: `explainDomainToday(domain, sites,
  dayKey)` and `explainCategoryToday(macro, micro, sites, dayKey)`, both
  walking the same attribution-key precedence chain live classification
  uses (via the also-newly-exported `classificationForKey`). Verified
  end-to-end in headless Chrome: sentence text, toggle, and the "Classify
  this channel" button opening the modal pre-filled with the right channel.
- **Verification sweep.** Ran the full headless-Chrome harness (chrome.*
  stub, seeded storage, local-date-part seeding, transitions killed) across
  popup (normal/first-run/dark), all 4 options tabs (light/dark), the
  new-rule modal, and all three block-page states. Zero console errors.
  Audit greps clean.
- **Untouched, as instructed:** spacing, colour, composition, hero
  promotion (R18 — that's Phase 3). Session 1's palette/type/fonts/popup
  work all stays as-is.

What Phase 2 inherits: a structurally-correct 4-tab page wearing Session 1's
tokens with zero composition work applied — exactly the "generic admin
console under new paint" state the audit describes in §2A. The Record tab in
particular is a flat wholesale concatenation of the old Progress + Analysis +
Categories tabs in source order; nothing has been reflowed, sized, or
re-hierarchized. That's the starting canvas for the rhythm/grid/density/
colour work below.

---

# PHASE 2 — Design system decisions — **Opus**

Two deliverables, both decisions, minimal code. Build directions to *look at*;
do not commit to one.

## 2A — The language is only one third applied

Session 1 replaced the *tokens* in `options.css` but never recomposed the page.
The dashboard still has its original layout, rhythm, card sizing, alignment and
density — the audit's "generic admin console" shape — wearing new paint. Only the
popup and block page were genuinely designed.

A design language change is font + colour + **spacing + placement + alignment +
density**. Session 1 did the first two. Specify the rest as a system:

- **Rhythm** — one set of values for section gap, card padding, label-to-control,
  heading-to-body. Applied identically on all three surfaces.
- **Grid and alignment** — numbers align with numbers, labels with labels, card
  edges with section edges. Currently each panel aligns to nothing in particular.
- **Density** — the dashboard is empty at 1400px, the popup is tight. Decide the
  intended density per surface and commit.
- **Composition** — reflow the panels themselves, not their contents. A card
  holding one number should not be the size of a card holding a table.
- **Type hierarchy** — the scale exists, its application is flat. Page title,
  section title, card title and label must be distinguishable at a glance by size
  **and** weight **and** colour.

Carry the paper-like feel of the block page across — that part landed and the
client likes it.

## 2B — Revised colour brief (overrides audit §2.1 where they conflict)

Client verdict on Session 1: calm and the right direction, but **dull**. Accurate,
and a real defect.

The audit said "colour only where it carries information"; Session 1 read that as
*fewer hues*. What it actually removed was **tonal range** — one paper tone,
hairlines everywhere, accent set to ink, so every button is near-black and nothing
announces itself.

**New brief: colour must do hierarchy, weight and recognition the way a well-made
modern app does, while staying mineral and calm.** Colour used for hierarchy *is*
colour carrying information. Restraint is not monotony.

Explore:

- **Tonal depth over new hues** — surface steps between `--bg-deep` and
  `--bg-panel` so sections layer instead of floating on one flat tone.
- **A real accent** — `--accent` is currently ink, which is why interactive
  elements are inert. Promote a warm mineral accent (bronze/ochre, or deeper
  verdigris/terracotta) to genuine accent duty at primary buttons, selected tab,
  focus and active states.
  **Decide deliberately:** if bronze becomes the accent, `--earned` stops being
  progression's exclusive material — the thing that made levelling feel earned
  rather than gamified. Either give the product a different accent and leave
  bronze to progression, or let bronze go everywhere and distinguish progression
  by treatment instead of hue. State which and why.
- **Let the semantic hues breathe** — `held`/`partial`/`missed` appear only as
  12%-opacity washes and hairlines. Allow larger areas and higher saturation where
  the state is the point: contribution grid, daily-standard chips, limit progress.
- **Category recognition** — Productive / General / Leisure should be identifiable
  by colour at a glance, consistently, product-wide. Currently three near-identical
  tints.

**Keep:** mineral pigment basis, paper substrate, no gradients, no glow shadows,
no hover lifts, serif reserved for the product's own voice.

## Phase 2 deliverable

Build **2–3 complete directions**. For each, render screenshots of popup +
dashboard + block page, in **light and dark**. Present them side by side with a
one-paragraph rationale each and a recommendation.

Session 1's mistake was choosing and applying in one pass with nothing to compare.
Do not repeat it.

**STOP after presenting. Do not apply the chosen direction — that is Phase 3.**
Write the chosen direction's exact token values and rhythm spec into
`docs/DESIGN-SYSTEM.md` so Phase 3 has something unambiguous to execute against.

## PHASE 2 — STATUS: done

- **Deliverable:** `docs/DESIGN-SYSTEM.md` — binding spec for Phase 3.
- **Three directions built and rendered**, not just described: A "Bronze Age"
  (bronze everywhere), B "Verdigris" (cool mineral accent, bronze stays
  progression's), C "Ink & Pigment" (accent stays ink, fix tonal range only).
  Each was a complete token set over a shared rhythm system, rendered across
  popup / Today / Record / block page in light and dark — 24 surfaces, zero
  console errors on all of them.
- **Recommended and specified: Direction B**, with its light accent deepened
  `#2C5A55` → `#1D4A50` after the render showed the original reading as a
  sibling of `--held`. Rationale and the two rejections are in Part 4 of the
  spec.
- **The bronze question is answered explicitly** (spec §2.1): bronze does *not*
  go everywhere; `--earned` stays progression-exclusive. Direction A was built
  specifically to test the alternative and it failed visibly.
- **Nothing was applied.** No repo CSS/HTML was touched — the directions live as
  scratch overlays only, per the phase's hard stop.
- **What Phase 3 inherits:** an unambiguous execution list in spec Part 3,
  including R18 (grid → hero of Record), plus two non-design bugs found during
  the spike and recorded in Part 5 so they are not rediscovered.

---

# PHASE 3 — Apply it — **Sonnet**

Execute `docs/DESIGN-SYSTEM.md` exactly. No new design decisions; if the spec is
ambiguous, ask rather than invent.

1. Update `tokens.css` to the chosen palette and rhythm values.
2. Apply the composition, spacing, alignment and density spec to `options.css`
   and `options.html` (the four-tab structure from Phase 1), `popup.css`,
   `blocked.css`, `progression.css`, `components.css`.
3. **Promote the contribution grid to hero of Record** (R18): compact identity
   line above it rather than a full card; streaks and records side by side;
   achievements collapsed with a count ("14 of 27 earned"); lifetime stats last as
   a plain definition list.
4. Full verification sweep (below).

---

# Verification — required in Phases 1 and 3

This harness caught real bugs in Session 1. Reuse it; don't rediscover it.

- Copy the extension to a scratch dir. Inject a `chrome.*` API stub script into
  each HTML `<head>`, plus a storage seed with realistic `sites` data. Render with
  headless Chrome: `--headless --virtual-time-budget=7000 --dump-dom` for errors,
  `--screenshot` for visuals. Collect `window.onerror` and `unhandledrejection`
  into `document.title`, then `--dump-dom | grep title`.
- **Inject `* { transition: none !important; animation: none !important }` before
  screenshotting.** Headless virtual time freezes CSS transitions mid-flight and
  makes correct states look broken.
- **Seed dates from local date parts, not `toISOString()`.** The UTC offset
  silently zeroes all usage data and every surface renders empty.
- Sweep: popup, first-run flow, open rule form, all three block-page states
  (`?reason=limit|restraint|blocked`), every options tab. Both themes.
- `npm test` green. Zero console errors on every surface.
- Audit acceptance greps: no `fonts.googleapis`, no `google.com/s2`, no `--sem-*`,
  no `--grad-*`, no hardcoded hex outside `tokens.css`.

Each phase ends with a summary of what changed and what the next phase inherits.
