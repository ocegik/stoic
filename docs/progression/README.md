# Stoic — Progression System

Design and specification for Stoic's long-term progression system. Nothing here
is implemented yet; these four documents are the complete plan.

Read in order:

| Doc | Contents |
|---|---|
| [`00-AUDIT.md`](00-AUDIT.md) | What the codebase already tracks, measures and emits; what is reusable; six gaps and defects that constrain the design, including one blocking bug in `usageSecondsForDate`. |
| [`01-PRODUCT-DESIGN.md`](01-PRODUCT-DESIGN.md) | Philosophy and six tenets; every accepted mechanic with its justification; **fourteen rejected mechanics** with reasons; the XP economy; the 27-achievement catalogue; 8 personal records; where each piece surfaces. |
| [`02-ARCHITECTURE.md`](02-ARCHITECTURE.md) | Seven invariants; module layout and dependency direction; complete data model; the XP, streak, achievement and record pipelines; the update flow; integration points; extensibility; UI structure; testing strategy. |
| [`03-IMPLEMENTATION-SPEC.md`](03-IMPLEMENTATION-SPEC.md) | Eight ordered phases with exact constants, function signatures, file-by-file edits, tests, a manual verification checklist, and the list of things that are easy to get wrong. |

## One-paragraph summary

Stoic is a product about doing *less*, so a progression system copied from
Duolingo or Strava would optimise against its own purpose. The design that
follows rewards decisions rather than volume: a **Daily Standard** of three
ceiling-type conditions (no rule broken, leisure under a ceiling, focus above a
target) defines a "held" day; held days drive XP, an uncapped level curve with
eight rank bands, a discipline streak, 27 achievements, 8 personal records and a
GitHub-style contribution grid. XP is monotonic, absence never counts as failure,
and the system never sends a notification. Architecturally it adds four classic
scripts, writes only from the service worker, stores an append-only daily ledger
in `chrome.storage.local`, and reuses the existing classification, segmentation
and focus-score analytics wholesale rather than introducing any new tracking.
</content>
</invoke>
