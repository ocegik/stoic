# Stoic — Design System

> **2026-10-18 — palette superseded.** The client rejected the warm mineral
> palette (Limestone / Verdigris / bronze) as too warm. `tokens.css` now holds a
> cool white + blue palette (deep navy in dark): blue accent, green/amber/red
> for held/partial/missed, violet for progression (`--earned`), and
> blue/slate/amber for Productive/General/Leisure. Token *names* and the
> "where each colour is allowed" rules below still apply; the hex values in
> Part 2 do not. The Record tab is now Week / Month / Year with prev/next.

Date adopted: 2026-07-31
Status: **binding for Phase 3**. This document is the spec Phase 3 executes.
No new design decisions belong in Phase 3 — if something here is ambiguous, ask.

Supersedes `docs/audit/PRODUCT-AUDIT.md` §2.1 where they conflict. Everything the
audit says about typography (§2.2), radii and elevation (§2.3) still stands and is
already shipped.

---

# Part 1 — The rhythm system

Session 1 replaced the tokens but never recomposed the page. This part is the
missing two thirds of the language: spacing, placement, alignment, density.
It is **one system, applied identically on all three surfaces**.

## 1.1 Rhythm — four gaps, and nothing else

Add to `tokens.css`:

```css
--rhythm-section: 56px;   /* between major sections */
--rhythm-block:   24px;   /* between blocks inside a section */
--rhythm-tight:   12px;   /* heading -> body, label -> control */
--rhythm-hair:     6px;   /* a value -> its own label */

--pad-card:       28px;   /* the one card padding */
--pad-card-tight: 20px;   /* cards whose content is a single row or number */
--col-gap:        24px;   /* every multi-column grid */
```

The `--space-*` scale stays for one-off internal spacing. These six are for
**structure**, and structure may not use anything else.

The rule that fixes the dashboard: **the gap above a section is large and the
gap inside it is small.** Today the whole page is `display:flex; gap:24px`, so a
heading is exactly as far from its own card as it is from the next section's
heading — which is why nothing reads as a group. Sections must be `display:block`
with `--rhythm-section` above each `.section-title` (`:first-child` excepted) and
`--rhythm-block` between sibling blocks.

## 1.2 Type hierarchy — four levels, each distinct by size AND weight AND colour

The scale already exists; its application is flat. Bind it:

| Level | Role | Size | Weight | Colour | Case |
|---|---|---|---|---|---|
| L1 | Page title | `--text-2xl` | 600 | `--text-primary` | Sentence |
| L2 | Section title | `--text-xs` | 600 | `--text-faint` | **UPPERCASE**, `letter-spacing: .12em` |
| L3 | Card title | `--text-lg` | 600 | `--text-primary` | Sentence |
| L4 | Body / description | `--text-base` | 400 | `--text-muted` | Sentence |

L2 dropping to an uppercase eyebrow is the single highest-leverage change on the
page. It stops seven `<h2>`s from competing with each other and with the card
titles beneath them, and it costs nothing. `.section-title` and
`.overview-section-title` both become L2.

The page subtitle drops to `--text-base` / 400 / `--text-faint`.

## 1.3 Grid and alignment

- **Container:** `1240px`, not 1400. At 1400 the dashboard is visibly empty; the
  content does not have the density to hold that measure. Padding `40px 40px 96px`.
- **Numbers align with numbers.** Every numeric cell gets `tabular-nums` —
  `.compact-metric-val`, `.perf-val`, `.top-site-time`, `.top-site-pct`,
  `.chart-val`, `.hero-primary-val`.
- **Top-sites rows are a grid, not a flex row:**
  `grid-template-columns: 24px 180px 1fr 64px 44px` with `--rhythm-block` gaps.
  Every bar then starts on one line and every number ends on one line.
- **Behaviour metrics** become an explicit 3-column grid capped at `720px`, not a
  free-flowing row.
- **Card edges align with section edges.** No card-inside-card.

## 1.4 Composition — a card's size follows its content's weight

The current page wraps every section in an identical `.card`, so a card holding
one number is the size of a card holding a table. Fix:

- `--pad-card` (28px) for cards that hold real content: tables, charts, grids,
  settings forms.
- `--pad-card-tight` (20px vertical / 28px horizontal) for single-row cards:
  identity, streaks.
- **No card at all** where the content is already a grid of tiles — the tiles are
  the surface. This applies to `#progStandingContainer`, `#progRecordsContainer`,
  `#progLifetimeContainer`: `background: transparent; border: none; padding: 0`.

Radius drops from `--radius-lg` to `--radius-md` on `.card`. `--radius-lg` is
reserved for modals and the block page.

## 1.5 Density, per surface — decided and committed

| Surface | Density | Why |
|---|---|---|
| **Popup** | Tight. Unchanged from Session 1. | It is a glance, seen many times a day. It landed. |
| **Dashboard** | Roomy, held to a 1240 measure. | It is read occasionally and deliberately. It was not roomy before — it was *empty*, which is a different thing and is a measure problem, not a spacing one. |
| **Block page** | The most generous of the three. Unchanged. | The whole point is to slow the reader down. It landed; carry its paper feel across, do not touch it. |

---

# Part 2 — Colour: "Verdigris"

## 2.1 The decision, and the one it forecloses

**A dedicated cool mineral accent — oxidised copper — takes interactive duty.
Bronze stays progression's exclusive material.**

The brief required this to be stated deliberately, so: **bronze does not go
everywhere.** `--earned` remains progression-only, exactly as `tokens.css` says.

This was tested, not assumed. A bronze-accent direction was built and rendered
(Part 4, Direction A) and it fails in a specific, visible way: with bronze on
primary buttons, the selected tab, focus rings *and* the XP bar, earned-achievement
borders and the level ring, progression stops being made of a different material
from the rest of the product. The distinguish-by-treatment escape hatch does not
survive contact — at 13px an achievement's bronze progress bar and a button's
bronze fill are the same thing. The material distinction is the mechanism that
makes levelling feel earned rather than gamified; spending it on buttons buys
warmth the product can get elsewhere.

Verdigris is chosen over the other non-bronze options because the palette's
semantic hues already occupy olive-green, ochre and iron-oxide. A cool blue-green
is the one mineral pigment left that collides with nothing.

## 2.2 Exact tokens — light ("Limestone")

Replace the corresponding block in `tokens.css`. Values are final.

```css
:root, [data-theme="light"] {
  color-scheme: light;

  --bg-deep:     #EFEBE1;
  --bg-panel:    #FBF9F4;
  --bg-raised:   #E4DFD2;
  --bg-sunken:   #E2DDCF;   /* NEW — empty grid cells, track backgrounds */
  --border:      #CFC8B7;
  --border-soft: #E0DACB;

  --text-primary: #171A19;
  --text-muted:   #4E5551;
  --text-faint:   #868D88;
  --overlay:      rgba(239, 235, 225, 0.94);

  /* verdigris — interactive duty */
  --accent:      #1D4A50;
  --accent-soft: #123A40;
  --accent-dim:  rgba(29, 74, 80, 0.10);
  --accent-ring: rgba(29, 74, 80, 0.30);
  --accent-ink:  #FBF9F4;

  --error:        #8C4A38;
  --error-border: #BE9384;

  --held:        #55684C;
  --held-soft:   #41533A;
  --held-dim:    rgba(85, 104, 76, 0.20);
  --held-border: #99AC8E;

  --partial:        #A8792C;
  --partial-soft:   #87611F;
  --partial-dim:    rgba(168, 121, 44, 0.20);
  --partial-border: #D0B27F;

  --missed:        #8C4A38;
  --missed-soft:   #713728;
  --missed-dim:    rgba(140, 74, 56, 0.20);
  --missed-border: #BE9384;

  --waived:        #7C7668;
  --waived-soft:   #625D52;
  --waived-dim:    rgba(124, 118, 104, 0.16);
  --waived-border: #BEB8AA;

  /* progression only — unchanged from Session 1 */
  --earned:        #A9793F;
  --earned-soft:   #8C6230;
  --earned-dim:    rgba(169, 121, 63, 0.16);
  --earned-border: #D6BA92;

  /* categories */
  --cat-productive:        #55684C;
  --cat-productive-dim:    rgba(85, 104, 76, 0.16);
  --cat-productive-border: #99AC8E;
  --cat-general:           #5F6A6E;
  --cat-general-dim:       rgba(95, 106, 110, 0.14);
  --cat-general-border:    #A8B0B2;
  --cat-leisure:           #A8792C;
  --cat-leisure-dim:       rgba(168, 121, 44, 0.16);
  --cat-leisure-border:    #D0B27F;
}
```

**`--accent` was moved from `#2C5A55` to `#1D4A50` during the spike.** At `#2C5A55`
the accent read as a sibling of `--held` olive when the two appeared on one screen —
verified on the popup, where the "Limit this site" button sits directly above the
standing chips. The deeper, bluer value separates cleanly. Do not lighten it back.

## 2.3 Exact tokens — dark ("Basalt")

Apply to **both** the `@media (prefers-color-scheme: dark)` block and the
`[data-theme="dark"]` block. They must stay identical.

```css
  --bg-deep:     #101211;
  --bg-panel:    #1A1D1B;
  --bg-raised:   #232725;
  --bg-sunken:   #161817;   /* NEW */
  --border:      #384039;
  --border-soft: #292E2B;

  --text-primary: #EEF0EC;
  --text-muted:   #ADB4AE;
  --text-faint:   #7F8781;
  --overlay:      rgba(16, 18, 17, 0.94);

  --accent:      #63B0AE;
  --accent-soft: #8CC9C6;
  --accent-dim:  rgba(99, 176, 174, 0.16);
  --accent-ring: rgba(99, 176, 174, 0.36);
  --accent-ink:  #101211;

  --error:        #C0705A;
  --error-border: #6B3A2C;

  --held:        #7E9670;
  --held-soft:   #99B08A;
  --held-dim:    rgba(126, 150, 112, 0.22);
  --held-border: #4A5842;

  --partial:        #C79A4E;
  --partial-soft:   #DCB77E;
  --partial-dim:    rgba(199, 154, 78, 0.22);
  --partial-border: #6E5A30;

  --missed:        #C0705A;
  --missed-soft:   #D49480;
  --missed-dim:    rgba(192, 112, 90, 0.22);
  --missed-border: #6B3A2C;

  --waived:        #8F877A;
  --waived-soft:   #A8A093;
  --waived-dim:    rgba(143, 135, 122, 0.18);
  --waived-border: #4C463D;

  --earned:        #C89A5C;
  --earned-soft:   #DAB27B;
  --earned-dim:    rgba(200, 154, 92, 0.20);
  --earned-border: #6E5535;

  --cat-productive:        #7E9670;
  --cat-productive-dim:    rgba(126, 150, 112, 0.20);
  --cat-productive-border: #4A5842;
  --cat-general:           #8C989C;
  --cat-general-dim:       rgba(140, 152, 156, 0.18);
  --cat-general-border:    #454F52;
  --cat-leisure:           #C79A4E;
  --cat-leisure-dim:       rgba(199, 154, 78, 0.20);
  --cat-leisure-border:    #6E5A30;
}
```

## 2.4 What changed from Session 1, and why

1. **Tonal depth.** `--bg-deep` moves from `#F4F1EA` to `#EFEBE1` and a fifth
   surface, `--bg-sunken`, is added. The page is now clearly a substrate that
   panels sit *on*. Previously panel and page were four points apart and every
   card floated on one flat tone — a large part of what read as "dull" was this,
   not hue.
2. **A real accent.** `--accent` stops being ink. This is the other large part.
3. **`--*-dim` opacity goes 0.12 → 0.20/0.22.** The semantic hues existed only as
   washes too faint to register. Where the state *is* the point, it now shows.
4. **Category tokens are new.** Productive / General / Leisure were three
   near-identical tints borrowed from `held`/`waived`/`partial`. They are now
   first-class and used consistently product-wide.

## 2.5 Where each colour is allowed

| Token | Allowed on |
|---|---|
| `--accent` | primary buttons, selected tab (incl. a 2px `inset 0 -2px 0` underline), focus rings, links, the top-sites bar fill |
| `--earned` | XP bars, level ring, earned-achievement borders and fills, rank chrome. **Nothing else. If it appears elsewhere it is a bug.** |
| `--held` / `--partial` / `--missed` / `--waived` | contribution grid cells, daily-standard chips, condition dots, rule-mode badges, limit progress |
| `--cat-*` | macro badges, category cards and their progress fills, category rows in the domain table |
| `--bg-sunken` | empty grid cells, unfilled progress tracks |

## 2.6 Kept, unchanged

Mineral pigment basis. Paper substrate. No gradients. No glow shadows. No hover
lifts. Serif reserved for the product's own voice (block-page reflection, rank
descriptor). Two elevations. Three radii. The eight-step type scale.

---

# Part 3 — What Phase 3 must apply

1. `tokens.css` — Parts 1.1, 2.2, 2.3 above.
2. `options.css` / `options.html` — Parts 1.2, 1.3, 1.4, 1.5.
3. `popup.css` — tokens only. Density and composition stay as they are.
4. `blocked.css` — tokens only. Do not recompose it.
5. `components.css` — accent wiring: `.btn-accent` uses `--accent` / `--accent-ink`,
   `:focus-visible` uses `--accent`.
6. `progression.css` — `--earned` wiring stays as-is; contribution grid cells go
   from 11px to **14px** with 3px gaps and `--radius: 3px`; `.prog-cell-absent`
   and `.prog-cell` default background become `--bg-sunken`; `.prog-cell-missed`
   becomes `--missed` at `opacity: .55` rather than `--missed-dim`.
7. **R18 — promote the contribution grid to hero of Record.** Per audit §3.10:
   compact identity line above it rather than a full card; streaks and records
   side by side; achievements collapsed with a count ("14 of 27 earned");
   lifetime stats last as a plain definition list. This is the largest single
   piece of Phase 3 and it is not optional — the rhythm system makes the Record
   tab readable, but the grid is still fourth on the page until R18 lands.
8. Full verification sweep per `docs/NEXT-SESSION.md`.

---

# Part 4 — The directions that were built, and why they lost

All three were built as complete token sets over the shared rhythm system and
rendered in headless Chrome across popup / Today / Record / block page, in light
and dark — 24 surfaces, zero console errors on all of them.

**Direction A — "Bronze Age."** Bronze promoted to full accent duty; progression
distinguished by treatment instead of hue; leisure moved to terracotta so it could
not be mistaken for the accent. It is the warmest of the three and it solves
"dull" most directly. It loses on the point the brief flagged in advance: rendered
side by side, accent bronze and earned bronze are indistinguishable, and
progression's material identity is the more valuable of the two things bronze can
buy. Rejected.

**Direction C — "Ink & Pigment."** The control: accent stays ink, and dullness is
treated purely as a tonal-range problem — five surface steps, stronger hairlines,
semantic pigment at full strength. It is a genuine improvement on Session 1 and it
proved that a real share of the dullness was tonal range rather than hue, which is
why the tonal changes in 2.4 are in the adopted spec. But it leaves every
interactive element in the product achromatic, which is the specific complaint.
It is the safe answer, not the right one. Rejected.

**Direction B — "Verdigris." Adopted**, with the light accent deepened from
`#2C5A55` to `#1D4A50` after the first render showed it reading as a sibling of
`held`. It gives the product a real accent, keeps bronze exclusive to progression,
and reads strongest in dark mode. Its one defect was a hue-distance problem, fixed
by moving the hue — not a structural one.

---

# Part 5 — Notes for Phase 3

Two things surfaced during the spike that are **not** design decisions and are
recorded here so they are not lost:

- `progression-ui.js` renders **"Level undefined reached"** in the level-up banner,
  and **"+25 XP · undefined"** on earned achievement cards, when the stored state
  has an achievement `earnedAt` / a `lastLevelUp` the renderer does not find in the
  shape it expects. Reproduced with a hand-seeded `progression` state. Worth a look
  during Phase 3 since Phase 3 is in these files anyway, but it is a data/render
  bug, not a styling one — do not let it expand scope.
- The Record tab renders a level-up banner above the page title on load, which
  overlaps the header at popup width. R18's recomposition should place it
  deliberately rather than letting it land wherever it currently does.
