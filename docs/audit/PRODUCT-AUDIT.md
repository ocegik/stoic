# Stoic — Product Audit & Implementation Roadmap

Date: 2026-07-29
Scope: v2.3.0, full codebase (`manifest.json`, `popup.*`, `options.*`, `blocked.*`,
`common.js`, `background*.js`, `youtube-*.js`, `progression-*.js`, `docs/progression/*`)
Author role: product design / UX research / design systems / product strategy
Audience: whoever plans the next quarter, and the Sonnet agents who implement it

This is an audit, not a compliment. Where something is good I say so once and move on.

---

# Part 0 — The one-paragraph verdict

Stoic is two products sharing a codebase. One is a genuinely original philosophy
product with the best-articulated design thinking I have seen in a personal
extension — `docs/progression/01-PRODUCT-DESIGN.md` is a document most funded
startups could not write, and the friction gate, the refusal metric and the
reality-check copy are real, defensible, differentiated ideas. The other is a
generic Tailwind-blue analytics console with eight tabs, six accent hues, a
developer debugger shipped in the consumer popup, and headings like "Storage &
Synchronization" and "Channel Database (yt_channels)". The second product is
currently the one the user sees first, and it is burying the first. Nothing in
this report is about adding features. Almost everything in it is about deleting,
merging, renaming and re-skinning until only the first product is visible.

The single most damaging finding is not a design issue at all: **YouTube watch-time
attribution silently fails whenever the MV3 service worker is evicted, and the
failure mode is to book productive watch time as Leisure.** That corrupts the focus
score, which corrupts the Daily Standard, which corrupts XP, streaks, achievements
and the entire progression ledger — the one asset that is not rebuildable. Fix
that before anything cosmetic.

---

# Part 1 — Product Identity

## 1.1 Does the product communicate its philosophy?

Partly, and only in three places out of about twenty.

**Where the philosophy is unmistakably present:**

| Surface | Evidence |
|---|---|
| `blocked.js:11-26` — the 14 reflections | "Discipline is just clarity, held a little past the point where it stops feeling urgent." This is excellent. It is paraphrase, not quotation, which avoids the fortune-cookie trap that every competitor falls into. |
| `blocked.js:168-370` + `options.html:695-743` — the friction gate | 60s unskippable wait, two consecutive hard puzzles, a ≥12-word written reason — and the *same* gate applies to loosening a rule in settings. That symmetry ("settings must never be an easier bypass than the blocked page") is the most philosophically coherent decision in the product. |
| `docs/progression/01-PRODUCT-DESIGN.md` | The six tenets (T1–T6), the 14 rejected mechanics, "an absent day is a good day". Rigorous, and the implementation actually obeys it. |

**Where the philosophy is absent or contradicted:**

| Surface | Problem |
|---|---|
| `manifest.json:3-4` | Name: `"Stoic - Site Time Limiter"`. Description: `"Set time limits or full blocks on distracting sites, with redirects and a reality-check block page."` This is the positioning of a commodity blocker. The word "Stoic" is doing no work; the subtitle actively disclaims it. |
| `options.html` (whole file) | Title: "Browsing Analytics & Moderation Dashboard". Tab labels: Overview, Progress, Detailed Analysis, Categories, Rules, YouTube & Debugger, Preferences, Backup. Section headings: "Storage & Synchronization", "Active Tab Metadata Inspector", "Channel Database (yt_channels)", "Extracted Video Database (yt_videos)", "Moderation Performance Summary". This is an admin console for an internal tool. |
| `popup.html:105-150` | A collapsible **Classification Debugger** with rows for "Cache Status", "Channel DB Lookup", "AI Rationale" — in the primary consumer surface, permanently. |
| `blocked.html:39` / `blocked.js:127,152` | The eyebrow reads **"DISCIPLINE HELD"** on the *limit* and *block* pages. The user is seeing that page precisely because discipline did **not** hold — they burned the limit, or they reached for a blocked site. The product congratulates the user at the moment of failure. This is a semantic inversion, not a typo. |
| `blocked.js:141` | Restraint headline: *"You're about to throw away your focus again."* Accusatory, presumptuous ("again"), and in direct conflict with the product's own T2 ("shame is not a durable behaviour-change mechanism — it is the emotional loop the feeds already exploit"). Two authors, two registers. |

## 1.2 What emotions should users feel?

Name them, because right now nothing in the codebase does, and that is why the
copy drifts. Proposed, and I recommend adopting these verbatim as the copy brief:

1. **Composure, not motivation.** The user should feel steadier after using Stoic,
   not fired up. No exclamation marks, no "Great job!", no streak-danger language.
2. **Being seen accurately, not judged.** The product's job is to hold up an
   honest mirror. "You spent 4h 12m here this week" is the tone. "You wasted 4h 12m"
   is not.
3. **Friction as respect, not punishment.** The gate is hard because the user's
   past self asked it to be. Copy should attribute the constraint to the user,
   never to the extension. Current copy already does this well once
   ("a restriction I set up on purpose") and badly elsewhere ("You're about to
   throw away your focus").
4. **A record worth keeping.** The ledger register — training log, not game.
   Already correctly specified in the progression doc; not yet felt in the UI.

The one emotion to actively design *out*: **anxiety about the number**. Every
competitor's retention depends on it. Stoic's stated thesis forbids it.

## 1.3 Does it have a memorable identity? Does it look like just another productivity extension?

Today: **it looks like another productivity extension, and a slightly dated one.**

Concretely, `tokens.css` uses `#0284c7` / `#0369a1` — these are Tailwind `sky-600`
and `sky-700`, unmodified. The brand mark is a Roman colonnade rendered in a
`135deg` sky-blue gradient with a `rx="8"` rounded square — which is the visual
signature of roughly every SaaS product built between 2020 and 2024. The buttons
have gradient fills, a `translateY(-1px)` hover lift, and coloured glow shadows
(`0 4px 14px rgba(2,132,199,0.2)`). That combination reads *marketing landing page*,
which is the exact opposite of the intended register.

The memorable parts of Stoic today are **behavioural, not visual**: the 60-second
wait, the puzzle streak reset, the "explain honestly why" textarea, the reflections.
A user would describe Stoic to a friend as "the one that makes you do maths before
you can open Twitter" — never as "the one that looks like X". That is a solvable
asymmetry, and it is the biggest single opportunity in this report.

## 1.4 Is the personality coherent across every screen?

No. There are four distinct voices:

1. **Reflective** — the block-page quotes, the restraint gate copy. On-brand.
2. **Accusatory** — the restraint headline, "That's a lot of reflexive taps". Off-brand.
3. **Enterprise-analytics** — all of `options.html`. Off-brand.
4. **Engineering-internal** — the debugger, `yt_channels`, `domain_rule`, "Cache Status: MISS". Should not be user-facing at all.

There is also a **vocabulary collision** that no user could parse:

| Concept | Names in use | Where |
|---|---|---|
| A user-created constraint | "discipline", "moderation rule", "rule", "site", "site limiter" | README, `blocked.html`, `options.html`, popup button, manifest |
| A daily time cap | "Moderation", "Time Limit", "limit", "daily limit", "daily allowance" | README, options modal, preferences |
| A full block | "Restraint", "Full Block", "block", "Restraint Mode", "Mindful Restraint" | README, options modal, `blocked.html:71` |

Three names for `mode: "restraint"` alone, and "Restraint" is *simultaneously* the
name of the full-block discipline type (README) and of the friction-gate mode
(options) and of Daily Standard condition C2 (progression). Pick one word per
concept and enforce it in a glossary. This is a two-hour fix with a
disproportionate effect on perceived quality.

## 1.5 What strengthens the identity / what weakens it

**Strengthens:** the friction gate; the reflection library; the refusal metric
("Turned back from this site: 14 times" is the single best line in the product);
the anti-shame tenets; the fact that loosening a rule costs the same as breaking one.

**Weakens, ranked:** the sky-blue palette; the extension name and store
description; the debugger in the popup; the eight-tab options page; the
"DISCIPLINE HELD" inversion; the accusatory restraint headline; `yt_channels` and
`domain_rule` shown to users; button gradients and hover lifts; the stale README
that documents an onboarding flow and a popup rule-editor that no longer exist.

## 1.6 What Stoic can learn from products with exceptional identity

Not "look like these" — the transferable mechanism in each case.

| Product | The mechanism | Application to Stoic |
|---|---|---|
| **iA Writer** | One decision (focus mode) is the entire product, and every surface defends it. The typeface *is* the brand — you recognise a screenshot instantly with no logo. | Stoic needs one recognisable typographic signature. Right now Inter + sky blue is recognisable as nothing. |
| **Things 3** | Restraint as luxury. Near-zero chrome, one accent colour used sparingly, generous whitespace, no gradients. It feels expensive because it withholds. | Directly applicable. Delete five of the six accent hues; delete every gradient. |
| **One Sec** | A single behavioural mechanic (breathe before opening) carried the entire brand and the App Store category. No dashboard needed. | Stoic's equivalent is the friction gate. It is currently the fourth thing a user encounters, not the first. |
| **Oak / Headspace** | The register is set by *copy*, before any pixel. Headspace's entire identity is a voice. | Stoic already has the voice, in one file. Extend `blocked.js`'s register to `options.html` and the identity problem is 60% solved with zero new visual work. |
| **GitHub contribution graph** | A record, not a score. It never scolds, never notifies, and is the most copied UI element of the last decade. | Already correctly adopted (§2.10 of the progression doc). Make it the hero of the Progress tab, not the fourth section. |
| **Teenage Engineering / Braun** | Material honesty. Colour appears only where it carries information; everything else is the substrate. | The palette recommendation in Part 2 is built on this. |
| **Kinopio** | Personality through *texture and copy*, not decoration. It feels handmade without being twee. | The path to "Roman without cosplay": one paper-grain substrate, one metal accent, restrained serif for reflections only. |

The pattern across all of them: **identity comes from subtraction plus one
irreducible signature.** Stoic currently has addition plus no signature.

---

# Part 2 — Design Language Audit

## 2.1 Colour — the central problem

**Current state.** `tokens.css` defines, per theme, an accent family plus **six**
full semantic families (blue, green, amber, red, purple, cyan), each with 5
variants (`base`, `soft`, `dim`, `border`, `glow`) = **30 semantic colour tokens**,
plus 3 gradients, plus 5 shadow tokens. Usage counts across the codebase:
green 37, red 36, amber 26, blue 20, purple 15, cyan 15. So all six are live.

**Why this is wrong for Stoic specifically** (not generic "too many colours" advice):

1. A product whose thesis is restraint is rendered in a six-hue palette. The
   medium contradicts the message on every screen.
2. `#0284c7` is Tailwind `sky-600` verbatim. There is no interpretation, no
   adjustment, no story. It communicates "made with a default config".
3. Purple and cyan carry **no distinct meaning** in this product — there is no
   third and fourth semantic state. They exist because the token file was written
   as a generic palette rather than derived from the product's actual states.
4. The accent is hardcoded outside the token system in at least two places
   (`components.css:22,26` — `rgba(2,132,199,0.2)`), so a palette change will
   leave blue glows behind on every primary button. This must be fixed as part of
   any re-skin or the re-skin will look broken.

**What the product actually needs to express in colour** — and it is only four things:

| Meaning | Where used |
|---|---|
| Neutral substrate (surfaces, text, borders, most data) | everywhere |
| **Held / kept** | grid cells, condition dots, streaks, "time saved" |
| **Partial / approaching** | 80–90% warnings, partial days |
| **Missed / pushed through** | violated rules, missed days, danger zone |

Four. Not six-plus-accent. Plus one **earned** metal used *only* by the progression
system, which is what makes levelling feel material rather than gamified.

### Recommended palette — "Limestone / Basalt"

The direction: **quarried stone, oxidised metal, ink on paper.** All hues derived
from mineral pigments (ochre, verdigris, iron oxide, bronze) rather than from
screen primaries. No textures, no statues, no serif-with-columns logo, no
travertine background images. The Roman reference lives entirely in the *pigments*
and in the typographic restraint — which is exactly how it reads timeless rather
than themed.

**Light — "Limestone"**

```
--bg-deep      #F4F1EA   warm limestone, replaces #f4f8fc
--bg-panel     #FBF9F4   bleached parchment
--bg-raised    #EBE7DD
--border       #D8D2C4
--border-soft  #E6E1D6

--text-primary #1A1815   ink (not pure black)
--text-muted   #4A443C
--text-faint   #8A8175

--accent       #26231D   ink — primary buttons are near-black, not blue
--accent-ink   #FBF9F4
--accent-ring  rgba(38,35,29,0.22)

--held         #55684C   verdigris / olive bronze   (replaces #10b981)
--partial      #A8792C   ochre                       (replaces #f59e0b)
--missed       #8C4A38   iron oxide                  (replaces #ef4444)
--earned       #A9793F   bronze — progression only, nothing else
```

**Dark — "Basalt"**

```
--bg-deep      #13120F
--bg-panel     #1B1915
--bg-raised    #24211B
--border       #3A352C
--border-soft  #2C2822

--text-primary #F2EEE5
--text-muted   #B7AFA1
--text-faint   #857D70

--accent       #EDE8DC   bone — primary buttons are light-on-dark
--accent-ink   #13120F
--accent-ring  rgba(237,232,220,0.24)

--held         #7E9670
--partial      #C79A4E
--missed       #C0705A
--earned       #C89A5C
```

**Deletions this implies:** all `--sem-blue-*`, `--sem-purple-*`, `--sem-cyan-*`
(15 tokens), all three `--grad-*` gradients, and the two hardcoded blue glows in
`components.css`. `--sem-green/amber/red` become aliases of `--held/--partial/--missed`
for one release so nothing breaks mid-migration, then are removed.

**Why this specific direction and not the obvious alternatives:**
- *Marble white + gold* → reads luxury-crypto, and gold-on-white fails WCAG at
  small sizes. Rejected.
- *Deep imperial purple + gold* → reads fantasy-game, contradicts §3.8 of the
  progression doc ("childish register"). Rejected.
- *Pure greyscale* → loses the semantic layer the analytics genuinely need, and
  greyscale-only reads as unfinished rather than restrained. Rejected.
- *Warm limestone + pigment semantics + bronze for earned* → distinctive at a
  glance, still legible as software, and the "earned" metal gives the progression
  system its own material without a single new UI concept. **Adopted.**

## 2.2 Typography

**Current:** Inter (400/500/600/700/800) + JetBrains Mono, loaded from the Google
Fonts CDN — via `@import` in `tokens.css:1` **and** a `<link>` in all three HTML
files, with *different weight sets in each*. Type sizes in use include 9, 10,
10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 17.5, 20, 22px. That is not a
scale, it is fifteen ad-hoc values.

**Four problems, in severity order:**

1. **The Google Fonts CDN is a network call to Google on every surface, including
   the block page.** The README promises "nothing leaves your device". Loading
   webfonts from `fonts.googleapis.com` sends the user's IP and a referer to
   Google every time the popup opens. This is a **stated-promise violation**, it
   breaks offline, and it will be flagged in Chrome Web Store review. **Self-host
   the fonts as `woff2` in `/fonts` and delete every CDN reference.** Severity:
   high. Difficulty: small.
2. **Duplicate, divergent font loading.** `@import` in CSS blocks rendering and is
   already redundant with the `<link>` tags, which themselves disagree about
   weights. Delete the `@import`; declare one `@font-face` block.
3. **No type scale.** Adopt eight steps and forbid anything else:
   `11 / 12 / 13 / 14 / 16 / 20 / 28 / 40`, with `--text-xs … --text-4xl` tokens.
   Fractional sizes (13.5, 11.5, 17.5) are a symptom of eyeballing, and they are
   why hierarchy feels mushy on the options page.
4. **No typographic signature.** This is the identity fix. Recommendation: keep
   Inter for all UI (it is invisible, which is correct), and introduce **one
   serif, used in exactly two places** — the block-page reflection placard and the
   rank descriptor on the Progress tab. Candidates, self-hosted: *Source Serif 4*,
   *Newsreader*, or *Instrument Serif*. Restricting a serif to "the product
   speaking, in its own voice" versus "the product reporting data" is a
   readable, defensible rule, and it makes a Stoic screenshot recognisable.

Keep JetBrains Mono, but narrow it to **numerals and the ledger only** (stat
values, the grid, XP, timers). It is currently applied loosely and dilutes the
"this is a record" signal it should be carrying.

## 2.3 Spacing, radii, elevation

- **Spacing:** the 4px-based `--space-1…16` scale in `tokens.css:80-89` is good and
  should stay. It is undermined by ~30 inline `style="margin-top: 14px"` /
  `style="max-width: 380px"` attributes in `options.html`, using values (14, 380)
  that are not on the scale. Clean these up; they are the loudest "amateur" signal
  in the codebase to anyone who opens the source.
- **Radii:** five steps (6/10/14/20/28). Cut to three: `--radius-sm 8`, `--radius-md 12`,
  `--radius-lg 20`. Also note `border-radius: var(--radius-sm, 10px)` appears
  throughout with a fallback — the fallback is dead code since the token always
  exists, and it silently disagrees with the token value.
- **Elevation:** five shadow tokens (`card`, `hero`, `subtle`, `panel-elevated`,
  `glass`) plus ad-hoc shadows. On a limestone substrate, heavy shadows read as
  dirt. Cut to **two**: `--shadow-raised` (a 1px hairline plus a barely-there
  drop) and `--shadow-overlay` (modals only). Prefer borders over shadows for
  separation — it is more honest on paper-toned surfaces and it survives dark mode
  intact.

## 2.4 Icons

Inline Lucide-style 24×24 stroke icons, `stroke-width: 2`, pasted directly into
HTML. Reasonable choice, three issues:

- The same SVG is duplicated across files (the shield icon appears in `popup.html`
  and `options.html`; the brand mark is pasted three times at three sizes with
  three different gradient IDs). Extract to a single `<symbol>` sprite or a small
  `icon(name)` helper.
- `stroke-width: 2` at 24px is heavy for the intended register. `1.5` reads calmer
  and matches the palette change.
- The YouTube tab uses the **actual YouTube logo mark** (`options.html:67`).
  Trademark risk in a published extension, and it visually endorses the platform
  the product exists to moderate. Replace with a neutral glyph.

## 2.5 Components — state coverage audit

| Component | Default | Hover | Focus-visible | Active | Disabled | Loading | Error | Verdict |
|---|---|---|---|---|---|---|---|---|
| `.btn-accent` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | — | Gradient + lift + glow should go |
| `.btn-ghost` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | — | No disabled state |
| `.field` | ✅ | ❌ | ✅ | — | ❌ | — | ✅ | No disabled/readonly |
| `.seg-btn` | ✅ | ❌ | ✅ | ✅ | ❌ | — | — | No hover; no disabled |
| `.switch` | ✅ | ❌ | ✅ | — | ✅ | ❌ | ❌ | Sync toggle can fail — needs error state |
| `.stat-cell` | ✅ | ✅ | — | — | — | ❌ | — | Hover lift on a non-interactive element is misleading |
| `.table` | ✅ | ✅ | ❌ | — | — | ❌ | ❌ | Rows are interactive but not keyboard-focusable |
| `.day-btn` | ✅ | ✅ | ✅ | ✅ | ❌ | — | — | OK |
| `.disclosure` | ✅ | ❌ | ❌ | — | — | — | — | `summary` has no focus style at all |
| `.empty-state` | ✅ | — | — | — | — | — | — | Exists in only **two** places |

**Systemic gaps:**

- **Loading states: effectively none.** One `Loading…` string in `blocked.html:51`.
  Every async render (`render()` in `popup.js`, `renderAll()` in `options.js`,
  the debugger fetch) paints zeros first, then real values. A user opening the
  popup sees "0m / 100% focus / No browsing activity" for a beat before the truth
  arrives — which on a *behaviour* product is actively misleading, not just ugly.
- **Empty states: two.** `popup.css:287` ("No browsing activity recorded today")
  and `options.html:273` (no rules). Missing for: the 7-day chart, the domain
  audit table, the category grid, the channel DB table, the video DB table, the
  streaks list, the debugger. A brand-new user therefore sees a dashboard of
  empty boxes with no explanation — the worst possible first run, given there is
  no onboarding either (§3.1).
- **Error states: near zero.** No `aria-live` region exists anywhere in the
  codebase (verified by grep). Sync failures, import failures and AI-provider
  failures write to `.settings-note` elements that screen readers will never
  announce and sighted users may not notice.
- **Motion:** `@media (prefers-reduced-motion: reduce)` appears in exactly one
  file (`progression.css:551`). Every `transform: translateY(-1px)` hover and
  every `transition: all 0.2s` elsewhere ignores it.

## 2.6 Animation

Currently: hover lifts on buttons and stat cells, `transition: all 0.2s` in
several places (`all` forces the compositor to watch every property — use explicit
property lists), a 0.5s stroke-dashoffset on the level ring, a countdown ring.

For this product the rule should be: **motion only where it conveys elapsed time
or a state change the user caused.** The countdown ring and the XP bar qualify.
Hover lifts on a stat card do not — they imply interactivity that does not exist.
Delete decorative motion; keep functional motion; honour reduced-motion globally.

---

# Part 3 — UI / UX Audit

Severity: **S1** = blocks or misleads a real user; **S2** = meaningful friction;
**S3** = polish.

## 3.1 [S1] There is no onboarding, and `<all_urls>` is requested with no explanation

**What's wrong.** `manifest.json:5-6` requests `"<all_urls>"` host permission plus
tabs, storage, alarms and notifications. On install the user sees Chrome's
"Read and change all your data on all websites" warning, then opens a popup
showing `0m`, a `100%` focus gauge, "No browsing activity recorded today", and a
collapsible panel labelled **Classification Debugger**. There is no first-run
explanation anywhere in the shipped code. The README documents one
(`README.md:18-21` — "First-run onboarding — a one-time, dismissible panel in the
popup explaining… specifically why it needs access to every site"); it does not
exist in `popup.html`. It was removed and the README was never updated.

**Why it matters.** `<all_urls>` is the highest-anxiety permission in the Chrome
store and the top cause of install abandonment for this category. The product's
entire trust proposition — "it watches your active tab locally; nothing leaves
your device" — is precisely the thing that is now unstated. This is also the
moment where the philosophy should land, and instead the first thing the product
says to a new user is "Cache Status: MISS".

**Recommendation.** A three-panel first-run sequence in the popup (not a new tab,
not a modal): (1) what Stoic is — one sentence in the product's own voice;
(2) why it needs to see every site, and the explicit promise that nothing leaves
the device; (3) *set your first rule right here* — pre-filled with the domain of
the tab the user currently has open. Dismissible, one-time, stored in
`chrome.storage.local`. This simultaneously fixes §3.2.

**Impact.** Highest of any item in this report. **Difficulty:** Medium.
**Best for:** Human decision on copy → then Sonnet. **Depends on:** §3.2 (the
quick-add path). **Risk:** low.

## 3.2 [S1] You cannot create a rule from the popup — the product's primary action costs 4 clicks and a tab switch

**What's wrong.** To limit the site you are currently looking at:
popup → *Manage Rules* → new browser tab opens → Rules tab → *+ New Moderation
Rule* → modal → **type the domain by hand** → set minutes → Save. Seven steps, and
the domain of the tab you were just on is never offered even though
`chrome.tabs` permission is already granted and `background.js:63` already has a
`resolveActiveTab()` helper.

The README (`README.md:22-49`) describes quick-add chips, in-popup editing and
Enter-to-save — all of which were removed when the popup became a "quick glance"
panel. The product traded away its core interaction for a dashboard.

**Why it matters.** "I'm on YouTube, I've been here too long, limit this" is *the*
moment of intent. It is the only moment where a user reaches for this product
proactively. Making it the most expensive action in the UI is the single largest
UX defect. It is also why the popup currently has nothing to do — it is a
read-only display in a product whose value is a decision.

**Recommendation.** Add one primary control at the top of the popup:
**"Limit <currentDomain>"** — a single row showing the active tab's domain, its
time today, and a one-tap action opening a compact inline form (mode segmented
control + minutes + Save) *inside the popup*. Keep "Open Dashboard" as a secondary
link. Restore Enter-to-save. Do not restore the eight quick-add chips — they were
a shortcut around a broken flow, and once the current domain is offered they are
redundant clutter.

**Impact.** Very high. **Difficulty:** Medium. **Best for:** Sonnet.
**Depends on:** nothing. **Risk:** low.

## 3.3 [S1] Eight tabs for a personal extension, with real overlap

Current: Overview · Progress · Detailed Analysis · Categories · Rules ·
YouTube & Debugger · Preferences · Backup.

| Problem | Detail |
|---|---|
| Overview ≈ Progress | Overview shows today's time, focus gauge, top sites, three counters. Progress shows identity, *today's standing* (the same focus/leisure numbers against thresholds), streaks, grid, records, achievements, lifetime. Two tabs answering "how am I doing today?". |
| Categories is one card | `options.html:205-219` — the entire tab is a single "Category Breakdown" grid. It belongs inside Detailed Analysis. |
| Backup is three cards | Export, Import, Danger Zone. Belongs in Preferences. |
| "Preferences" is titled "Storage & Synchronization" | Tab label and page heading disagree. It also contains theme, default action and the Daily Standard — none of which are storage. |
| "YouTube & Debugger" | A platform-specific developer surface promoted to top-level navigation, ranked above Preferences. |

**Recommendation — four tabs:**

1. **Today** (merge Overview + the "today's standing" part of Progress) — today's
   time, focus, the three Daily Standard conditions, top sites.
2. **Record** (Progress minus today's standing + Detailed Analysis + Categories) —
   the contribution grid as the hero, then streaks, records, achievements, the
   7-day chart, category breakdown, the domain audit table.
3. **Rules** (unchanged, plus the YouTube channel classification tables moved here —
   they *are* rules about what counts as what).
4. **Settings** (Preferences + Backup + Danger Zone).

The debugger disappears entirely as a tab — see Part 5.

**Impact.** High. **Difficulty:** Large. **Best for:** Sonnet, after a human
signs off on the IA. **Depends on:** Part 5 decision. **Risk:** medium (touches
every render function in `options.js`).

## 3.4 [S1] The tab bar is not keyboard-accessible despite claiming to be

`options.html:45` declares `role="tablist"` with `role="tab"` children and
`aria-selected`, but `options.js:8-29` binds **click only**. There is no `keydown`
handler, no arrow-key navigation, no `tabindex` roving, and no `aria-controls` /
`id` pairing between tabs and panels. Announcing the ARIA tab pattern and then not
implementing it is worse than using plain buttons — a screen-reader user is told
to press arrow keys, and nothing happens.

**Recommendation.** Implement the full pattern (roving tabindex, Left/Right/Home/End,
`aria-controls`), or drop the ARIA roles and use plain links with `:target`.
**Difficulty:** Small. **Best for:** Sonnet. **Risk:** none.

## 3.5 [S1] The block page congratulates the user for failing

`blocked.js:127` sets the eyebrow to `"DISCIPLINE HELD · MODERATION"` on the
*limit-exceeded* page, and `blocked.js:152` sets `"DISCIPLINE HELD · RESTRAINT"`
on the *full block* page. In both cases the user is there because they hit the
wall. Only the restraint interstitial (`blocked.js:140`, "MINDFUL PAUSE") is
accurate — and that is the one case where discipline *might* still hold.

**Recommendation.** Eyebrows should state the fact, not a verdict:
`"DAILY LIMIT REACHED"`, `"UNDER FULL RESTRAINT"`, `"PAUSE BEFORE OPENING"`. Save
"held" language for the Progress surfaces, where it is earned.
**Difficulty:** Trivial. **Risk:** none.

## 3.6 [S2] The restraint headline shames, contradicting the product's own tenet

`blocked.js:141`: *"You're about to throw away your focus again."* The
progression design doc, §T2, states plainly that shame "is the emotional loop the
feeds already exploit". The subhead then asks three rhetorical questions and
tells the user their life isn't moving forward. It is the most aggressive copy in
the product, aimed at the moment the user is most likely to rage-uninstall.

**Recommendation.** Replace with the calm register that already works. Something
in the family of: *"You asked to be stopped here."* / subhead: *"Fifteen seconds
from now this will feel less urgent. If it doesn't, the way through is below."*
State the constraint's origin (the user), not a judgement of their character.
**Difficulty:** Trivial (copy). **Best for:** Human decision. **Risk:** none.

## 3.7 [S2] `history.back()` on the block page can loop the user back into the gate

`blocked.js:372-384` — "Go back" calls `window.history.back()` when history depth
> 1. On a SPA like YouTube the previous history entry is frequently *the same
site*, which re-trips the rule, re-shows the gate, and increments
`entry.timesTripped` again (`background.js:247`). The user experiences a loop, and
"Times you've reached for it" inflates with taps the user never made.

**Recommendation.** Prefer closing the tab, or navigating to `chrome://newtab`,
over `history.back()`. Additionally, debounce `timesTripped` so a re-trip on the
same domain within ~60s does not double-count.
**Difficulty:** Small. **Risk:** low. **Note:** this also corrupts the "Times
tested / Times paused" stat the block page displays, so it is a data-integrity
fix, not just navigation polish.

## 3.8 [S2] The extension silently records every domain you visit, forever, with no way to see or prune the list

`background.js:174-184`: any domain that isn't already in `sites` gets an entry
auto-created with `mode: "unconstrained"`. Nothing ever removes those entries —
the only pruning in the codebase is for the YouTube video DB
(`youtube-classifier.js:499`) and the progression ledger. So `sites` becomes a
permanent, unbounded list of every domain the user has ever visited while the
extension was installed.

Three consequences:

1. **Storage growth is unbounded.** A year of normal browsing is thousands of keys.
2. **The sync toggle is a trap.** `options.html:291` advertises "Chrome Sync
   Storage Limit: 8 KB per item" and offers a switch that moves `sites` to
   `chrome.storage.sync`. `sites` will exceed 8 KB within days of normal use. The
   UI presents this as a normal preference.
3. **It is a privacy surface the user was never shown.** The product's promise is
   that nothing leaves the device — true — but a complete browsing-domain history
   living in extension storage with no viewer and no delete-one control is a
   reasonable thing for a user to want control over, and Export dumps it all to a
   JSON file.

**Recommendation.** (a) Prune `unconstrained` entries with no usage in the last
14 days and no rule attached. (b) Replace the sync toggle with sync of **rules
and preferences only** (a small, bounded object), never the usage ledger, and say
so. (c) Add a "Tracked domains" list in Settings with per-row delete. (d) Say
plainly in onboarding that Stoic keeps a local time ledger for every site you
visit — stated up front it is a feature; discovered later it is a betrayal.
**Difficulty:** Medium. **Best for:** Sonnet. **Risk:** medium (touches the
storage layer).

## 3.9 [S2] "Reset All Data" does not reset all data

`options.js:1096-1108` — the friction-gated reset sets `sites = {}` and saves.
The copy says "every limit, restraint, and block you've set up, gone at once,
along with your history." But the progression state (XP, level, achievements,
streaks, the entire ledger) lives in a separate storage key and is untouched. The
user is told they have a clean slate and does not.

There is a legitimate argument that the ledger *should* survive (T2 — nothing is
ever taken away). If so, the copy must say so: "Your record — level, streaks and
achievements — is kept." Either way, copy and behaviour must agree.
**Difficulty:** Trivial (copy) or Small (add a second, separately-gated reset).
**Risk:** none.

## 3.10 [S2] Information density and hierarchy on the Progress tab

Seven `<h2 class="section-title">` headings stacked vertically
(`options.html:142-161`), all at the same visual weight, each followed by a card.
The contribution grid — described in the product doc as "the single highest
perceived-value element per line of code" — is fourth, below the fold. Identity,
standing and streaks all compete for the top.

**Recommendation.** Grid first, immediately under a compact identity line
(level ring + rank + XP bar as one row, not a full card). Streaks and records
side by side. Achievements collapsed by default with a count
("14 of 27 earned"). Lifetime statistics last, as a plain definition list, not cards.
**Difficulty:** Small–Medium. **Risk:** low.

## 3.11 [S3] Miscellaneous, batchable

- **Favicons are fetched from `google.com/s2/favicons`** (`popup.js:131`,
  `options.js:486`) — this sends every top domain the user visits to Google every
  time the popup opens. Same class of promise-violation as the fonts, and more
  sensitive. Use `chrome://favicon2` / the tab's own `favIconUrl`, or drop
  favicons for a monogram. **This one is genuinely urgent.**
- The popup is `352px` wide (`popup.css:4`) with no max-height handling; with the
  progression strip, level-up banner and debugger all present it will scroll.
- `.stat-cell:hover { transform: translateY(-1px) }` on non-interactive elements.
- `options.html` contains ~30 inline `style=` attributes.
- Three copies of the brand SVG at three sizes with three gradient IDs.
- `README.md` documents features that no longer exist (onboarding, quick-add
  chips, in-popup discipline form, Enter-to-save, 7-day chart per row, collapsed
  settings). It should be rewritten or deleted; a wrong README is worse than none.
- `.field-row label { width: 80px }` (`components.css:106`) truncates longer
  labels like "Leisure ceiling" at some zoom levels.

---

# Part 4 — Feature Audit

| # | Feature | Where | Verdict | Reasoning |
|---|---|---|---|---|
| 1 | Time-limit rules (Moderation) | `background.js` tick | **Stay** | The core. Well implemented — real elapsed time, clamped, foreground-only. |
| 2 | Full block | same | **Merge into a strictness spectrum** | Block and Restraint are the same feature at two friction levels. Present as one "Restraint" mode with a strictness setting rather than two modes in a three-way segmented control. |
| 3 | Restraint Mode (friction gate) | `blocked.js:168` | **Stay — promote to hero** | The best thing in the product and the most defensible differentiator. Currently the third option in a segmented control. |
| 4 | Friction gate on loosening rules | `options.js:259-281` | **Stay** | Philosophically the sharpest decision in the codebase. Barely surfaced — the user never learns it exists until they trip it. Say so when a rule is created. |
| 5 | Reality-check block page | `blocked.html` | **Stay, retune copy** | Strong. Fix the eyebrow inversion and the shaming headline. |
| 6 | Rotating reflections | `blocked.js:11` | **Stay + personalise** | 14 items, never repeating consecutively. Let users add their own — see §6.1. |
| 7 | Redirect-instead-of-block | `background.js:100` | **Stay, demote** | Cheap, genuinely useful for some users, zero maintenance. Keep as a per-rule option under advanced settings; it is not a headline feature. |
| 8 | Schedules (days + focus hours) | `common.js:173-228` | **Stay, resurface** | Solid logic, buried in a `<details>` inside a modal. Nearly undiscoverable. |
| 9 | Weekday/weekend split limits | `schedule.dayLimits` | **Simplify** | Supported in the data model and in `limitMinutesForDate`, but there is **no UI to set it** in the current options modal. Either build the UI or delete the code path. Dead half-features are a maintenance tax. |
| 10 | Pause/resume a rule | `entry.paused` | **Stay** | Honest escape valve. Should require the friction gate (it currently appears not to route through `isLoosening`). |
| 11 | 80% / 90% notifications | `background.js:45-56` | **Stay** | The copy is genuinely on-brand. The only notifications in the product; keep it that way. |
| 12 | Focus score | `common.js:1359` | **Stay** | Good primitive. Its correctness depends entirely on classification — see Part 5. |
| 13 | Category taxonomy + overrides | `common.js:537-604` | **Stay, simplify UI** | Three macro categories is right. The micro-category list plus custom-category modal is more configuration than a personal tool needs. |
| 14 | YouTube per-video attribution | `youtube-classifier.js` | **Stay — but fix, it is broken** | The idea (a lecture ≠ a prank video) is Stoic's strongest analytical differentiator. The delivery is unreliable. Part 5. |
| 15 | Channel database + built-ins | `youtube-classifier.js` | **Stay, relocate** | Belongs under Rules, framed as "what counts as what", not as a database table with a storage-key name in the heading. |
| 16 | Video database table | `options.html:543` | **Remove from UI** | A log of every video you watched, shown as an admin table with "Extracted At" columns. Keep the data (it powers attribution); delete the surface. |
| 17 | **Classification Debugger (popup)** | `popup.html:105` | **Remove** | Part 5. |
| 18 | **Classification Debugger (options tab)** | `options.html:384` | **Remove, replace with a one-line "why?"** | Part 5. |
| 19 | **Custom remote AI API** | `options.html:474` | **Remove** | An API-key field and an arbitrary endpoint URL that video titles get POSTed to. It breaks the "nothing leaves your device" promise, it is unconfigurable-in-practice for a normal user (what endpoint? what response shape?), it is a security surface (a key in `chrome.storage`), and it will complicate Web Store review. The local heuristic is the honest answer. Highest maintenance-to-value ratio in the product. |
| 20 | AI confidence threshold slider | `options.html:485` | **Remove** | A 0.50–0.95 slider over an opaque internal score, exposed to end users. Pick a sensible constant. |
| 21 | Auto-classify toggle | `options.html:496` | **Remove** | Should always be on; if it is wrong the fix is a better classifier, not a switch. |
| 22 | Progression: XP / levels / ranks | `progression-*.js` | **Stay** | Excellently specified and correctly restrained. |
| 23 | Progression: contribution grid | `progression-ui.js` | **Stay — promote to hero** | Highest value per line in the product. |
| 24 | Progression: refusals | `progression-engine.js` | **Stay — promote hard** | "Turned back from this site: 14 times" is the most on-brand sentence Stoic can say. It appears once, in a small stat cell, on the restraint page only. |
| 25 | Progression: 27 achievements | `01-PRODUCT-DESIGN.md §5` | **Stay, trim later** | Well-designed. Watch that "Achievements" doesn't drift into the game register the docs correctly reject. Revisit after real usage data — several may never fire. |
| 26 | Progression: personal records | same | **Stay** | Cheap, on-brand. |
| 27 | Theme light/dark/system | `common.js:53-95` | **Stay** | Correctly implemented, respects `prefers-color-scheme`. |
| 28 | Theme toggle in popup **and** segmented control in Preferences | `popup.html:39`, `options.html:305` | **Merge** | Two controls for one setting, in different shapes, that can disagree (the popup toggle is binary; Preferences has three values). |
| 29 | Chrome sync toggle | `options.html:293` | **Redesign** | §3.8 — it will exceed quota. Sync rules and preferences only. |
| 30 | Export / import JSON | `options.html:358` | **Stay, merge into Settings** | Correct and version-gated. |
| 31 | Reset all data | `options.js:1096` | **Stay, fix copy** | §3.9. |
| 32 | Domain audit table + quick moderation | `options.html:191` | **Stay** | Genuinely useful — the best path from "what am I actually doing" to "put a limit on that". Underexposed. |
| 33 | "Session Insight" card | `options.html:172` | **Evaluate for removal** | A single generated sentence labelled "AI Insight" in one place and "Session Insight" in another. If it can't say something a user couldn't read off the chart, delete it. |
| 34 | "Time Saved" metric | `common.js:1648` | **Rename or remove** | An estimate presented as a hard number with a green "positive" class. Stoic's whole position is honest measurement; a flattering estimate is the one number in the product that isn't. Either show the derivation or cut it. |

**Count: 11 features recommended for removal or absorption.** That is the point.

---

# Part 5 — YouTube Debugger Review

## 5.1 Your instinct is right, but the diagnosis is off

You describe the debugger as unreliable — "it frequently fails to detect videos".
The debugger is not the thing that is broken. **The debugger is an accurate
window onto a broken data pipeline.** Deleting it without fixing the pipeline
would just hide the failure, and the failure is corrupting the progression ledger.

## 5.2 Root cause 1 (dominant) — MV3 service-worker eviction wipes the metadata map

`background.js:268` declares `let latestYouTubeMetadataByTab = {}` — an
**in-memory** object in a Manifest V3 service worker. Chrome terminates that
worker after ~30 seconds of inactivity and restarts it on the next event. On
restart the map is empty.

The content script does not re-send. `youtube-content.js:141-142` computes a hash
of the current metadata and returns early when it matches `lastMetadataHash`. A
tab that has been sitting on the same video for ten minutes has an unchanged
hash, so it never broadcasts again. Nothing anywhere requests metadata on demand —
`handleGetDebugInfo()` (`background.js:363`) reads the map and takes whatever is
there; there is no `chrome.tabs.sendMessage` fallback.

**The consequences, in order of severity:**

1. `attributionKeyForContext(null)` returns `BROWSE_KEY`
   (`youtube-classifier.js:1167`), so `creditYouTubeSeconds` books the time to
   generic YouTube browsing, which resolves through the domain rule to
   **Leisure · Streaming**. A two-hour lecture on a channel the user explicitly
   classified as Productive is recorded as two hours of leisure.
2. That wrong number feeds `calculateFocusScore`, which feeds Daily Standard
   conditions **C2** (leisure ceiling) and **C3** (focus target), which decide
   whether the day is *held*, which decides XP, the streak, the grid cell colour,
   and every achievement predicate.
3. Settled days are frozen by design (§3.14 of the product doc — correctly). So
   this corruption is **permanent and unfixable after the fact**.
4. The debugger showing `--` is merely the visible symptom.

This is not an edge case. It happens every time the worker idles out, which on a
normal machine is constantly.

## 5.3 Root cause 2 — no re-injection into already-open tabs

`manifest.json` registers the content script at `document_idle` for
`*://*.youtube.com/*` with no `chrome.scripting.executeScript` on install/update.
Any YouTube tab already open when the extension is installed, updated, or
re-enabled has no content script until it is manually reloaded. Same downstream
consequence as above.

## 5.4 Root cause 3 — channel extraction grabs the wrong channel

`youtube-content.js:81` — when no channel name has been found yet, it falls back
to `document.querySelector("a[href*='/@']")`, i.e. **the first handle link
anywhere in the DOM**. On a watch page whose owner block hasn't rendered, and on
`/shorts/` pages, the first such link is frequently a *recommended* video's
channel in the sidebar. Similarly `a[href*='/channel/UC']` (line 66) can match a
sidebar entry.

This is worse than a miss: a miss is visibly `--`, but this produces a
**confidently wrong channel**, which then gets written to the video DB by
`recordYouTubeVisit`, cached, and — if the user has classified that channel —
silently misattributes the time with full confidence. Some of the "unreliability"
you feel is almost certainly this, not the blank case.

Also: `extractTitle()` (line 39) targets `h1.ytd-watch-metadata`, which does not
exist on `/shorts/`. It falls through to `document.title`, which is usually fine,
but it means Shorts are systematically the least reliable content type — and
Shorts are exactly the content a restraint product most needs to classify
correctly.

## 5.5 Verdict on the feature

Split the question in two, because "the YouTube Debugger" is currently one label
over two very different things.

**A. The classification pipeline (extraction → attribution → category): KEEP and FIX.**
It is Stoic's most defensible analytical differentiator — no competitor
distinguishes a lecture from a prank video, and the read-time category resolution
(so re-classifying a channel retroactively corrects today's numbers) is genuinely
clever engineering. It is also load-bearing for the entire progression system.
**Not optional.** Fix:

1. Persist per-tab metadata in **`chrome.storage.session`** instead of a module
   variable, so worker eviction is survivable. (Requires no new permission.)
2. Add a **pull path**: background sends `REQUEST_METADATA` to the tab; the
   content script replies with a fresh extraction. Call it whenever the map has
   no entry for a YouTube tab — at tick time and at debug time. This makes the
   push path an optimisation rather than a single point of failure.
3. Have the content script **re-broadcast on `chrome.runtime.onMessage` ping and
   on `visibilitychange`**, and reset `lastMetadataHash` when the connection to
   the worker was lost.
4. On `chrome.runtime.onInstalled`, `executeScript` into all open YouTube tabs.
5. Scope channel extraction to the **owner container only**
   (`#owner`, `ytd-video-owner-renderer`, `#upload-info`) and to
   `ytd-reel-player-overlay-renderer` for Shorts. Never fall back to a
   document-wide `a[href*='/@']` — return `null` instead. **A miss is safe; a
   wrong channel is not.**
6. Add a `youtube-attribution.test.js` covering: worker restart with a live tab,
   Shorts, playlist autoplay, and "metadata absent → does the time land in
   BROWSE_KEY or nowhere". Decide deliberately which of those two is correct;
   right now it is BROWSE_KEY → Leisure by accident, and "unattributed" would be
   the more honest bucket.

**B. The debugger UI (both surfaces): REMOVE.**

- The popup panel (`popup.html:105-150`): delete outright. It is a developer tool
  in the consumer surface, it is the third thing a new user sees, and it
  broadcasts internal vocabulary (`domain_rule`, `MISS`, `yt_channels`) that
  actively damages the product's identity.
- The options tab (`options.html:384-565`): delete the tab. Keep the *channel
  classification table* (move it under Rules, retitled "What counts as what");
  delete the live inspector, the precedence-chain trace, the video database
  table, and the entire AI settings card (§4 items 19–21).

**Replace both with one honest, user-level affordance:** on any YouTube row in
the domain audit table and on the Categories breakdown, a small "Why?" link that
opens a plain-language sentence — *"Counted as Leisure because youtube.com's
default is Leisure and this channel hasn't been classified yet. [Classify this
channel]"* — with the action inline. That serves the actual user need (I don't
trust this number, and I want to correct it) without exposing the machine.

Keep the precedence trace as a **console log behind a debug flag**, for you. You
will still need it; the user never did.

**Why not "make it manual" or "make it passive"?** Manual classification of every
video is unusable at volume, and it would reward configuration work — which the
progression doc explicitly rejects (§3.10). Passive-only (no correction path) is
worse: an uncorrectable wrong number in a product about honest self-measurement
destroys trust in every other number. The right shape is **automatic with a
one-tap correction at the point of doubt**, which is what the "Why?" affordance
gives you.

---

# Part 6 — Personalisation

The organising principle: **personalise the product's voice and its strictness;
never personalise its structure.** Voice and strictness are what make it feel like
*your* Stoic. Layout, widgets and dashboards are configuration work that adds
surface area, adds bugs, and gives the user something to fiddle with inside a
product designed to stop fiddling.

## 6.1 High value

| # | Idea | Why it's high value | Difficulty |
|---|---|---|---|
| 1 | **Custom reflections.** Let users add their own lines to the block-page rotation, and mark built-ins as hidden. | The single highest identity-per-effort item available. A user who has typed their own sentence and then reads it back at 11pm on a bad night has a relationship with the product that no feature list creates. Pure data, no new mechanics. | **Small** |
| 2 | **Custom gate questions.** Same for `REFLECTION_QUESTIONS` (`common.js:234`). | Same reasoning; the gate is where the product is most present. | **Trivial** (once #1 exists) |
| 3 | **Strictness presets** — Light / Standard / Severe — that set gate wait, puzzle count and minimum reason length together, chosen **per rule**. | Currently `RESTRAINT_WAIT_SECONDS`/`PUZZLE_STREAK`/`MIN_REASON_WORDS` are global constants and the options modal explicitly says restraint is not configurable. That is defensible as a default, but it is the #1 reason a user with a different threshold gives up. Presets keep it a *stance*, not a slider. | **Medium** |
| 4 | **A "Focus session" / temporary maximum strictness** — one button: "Everything leisure, blocked, for 90 minutes." | The most-requested capability in this entire category, and Stoic has all the machinery (schedules, restraint passes, category taxonomy). It also makes the popup *useful* rather than informational. Note: this is close to a new feature, not just personalisation — flagged as such in the backlog. | **Medium–Large** |
| 5 | **Schedules resurfaced.** Already built; move out of the `<details>` inside a modal. | Zero new logic; large discoverability gain. | **Small** |
| 6 | **Leisure ceiling & focus target.** Already shipped. | Exactly the right two knobs. Keep, don't add more. | Done |
| 7 | **Choose your own rank vocabulary** (later): a small set of tone options for rank titles — e.g. plain descriptive vs. the current Observer→Self-Governed ladder. | Cheap, and it defuses the one place where the progression system risks feeling like a game to some users. | **Small** |

## 6.2 Low value — do not build

| Idea | Why not |
|---|---|
| **Themes beyond light/dark** | Rejected by the progression doc (§3.8) as a reward; equally wrong as a preference. A product with a strong identity does not offer to look like something else. One palette, two modes. |
| **Configurable dashboard layout / widgets** | Multiplies QA surface, dilutes the designed hierarchy, and lets users bury the grid — the element with the most value. If a section is worth hiding, delete it for everyone. |
| **Reminder frequency settings** | There should be exactly two notifications (80/90%) and no cadence to tune. The moment reminders become configurable, the product acquires a notification strategy — which T3 forbids. |
| **Custom blocking logic (regex / URL patterns)** | Power-user catnip, permanent support burden, and it turns rule-writing into an engineering task. Subdomain matching already covers the real cases. |
| **AI provider / endpoint / confidence** | §4 items 19–21. Remove entirely. |
| **Per-rule custom block-page copy** | Sounds appealing; in practice users write one message and it goes stale. Global custom reflections (#1) delivers the same emotional payload with a fraction of the surface. |
| **Sounds** | No. |

## 6.3 The rule to apply to any future personalisation request

> Does this let the user express **who they are** or **how strict they want to be**?
> Ship it. Does it let them rearrange **what the product is**? Don't.

---

# Part 7 — Future Vision (two years out)

## 7.1 What Stoic should become

**"The honest record of your attention, and the one thing that will actually stop
you."** Two capabilities, deep, and nothing else:

1. **The ledger.** Multi-year, local, exportable, never gamified. After two years
   this is unbeatable and uncopyable — a competitor can clone the UI in a week and
   cannot clone your 700-day grid. This is the retention asset, correctly
   identified in the progression doc, and it starts accruing the day the
   classification bug is fixed (not before — the data is only worth what it's
   worth if it's accurate).
2. **The gate.** The most respected friction mechanism in the category — the one
   people mention by name. Configurable in severity, never in whether it exists.

Everything else is in service of those two.

## 7.2 What Stoic must never become

- A **productivity dashboard**. It is drifting this way now; eight tabs is the
  evidence.
- A product with a **server**. §3.7 of the progression doc calls this permanent,
  not deferred. Agreed. It is the promise the whole thing rests on.
- **Social** — leaderboards, sharing, accountability partners. Comparison is the
  mechanic the product exists to oppose.
- **Notification-driven**. Two, forever.
- **A game** — mascots, cosmetics, seasons, quests. The docs already forbid this;
  the risk is drift, not intent.
- **Freemium with the ledger behind a paywall.** If Stoic is ever monetised, sell
  the software, never the user's own record.

## 7.3 Missing opportunities today

1. **The gate is not the product's front door.** The single most differentiated
   thing is discovered fourth. Store listing, onboarding, and the popup should
   all lead with it.
2. **Refusals are nearly invisible.** The most Stoic metric in existence, shown in
   one small stat cell on one page. It should be on the popup, in the grid, and in
   the store screenshots.
3. **No weekly review moment.** The product measures a week (Weekly Standard,
   7-day chart, trailing usage) but never *presents* one. A quiet, non-notifying
   "last week" panel that appears on Mondays is retrospective (T5-compliant), needs
   no new data, and is the natural home for the reflective voice.
4. **No export of the ledger as something a human wants to keep** — a printable
   year in review, a plain-text log. Cheap; deepens the "record" positioning.
5. **The store listing does not exist as a designed artefact.** Name, description,
   screenshots and the permission rationale are the top of the funnel, and today
   they say "Site Time Limiter".

## 7.4 Exciting but unrealistic (be honest about these)

- **Mobile.** Chrome extensions don't run on mobile Chrome. Cross-device would
  require a whole second product and a sync server, which contradicts §7.2.
  Accept desktop-only; say so plainly rather than implying otherwise.
- **Tamper-proof enforcement.** `README.md:123-126` is already honest: an unpacked
  extension can be disabled from `chrome://extensions`. Anything stronger needs
  enterprise policy or an OS agent. Don't chase it; lean into the framing that
  Stoic is a commitment device, not a prison.
- **On-device LLM classification.** Attractive, and `chrome.ai` may make it viable —
  but the heuristic plus a good correction path solves 90% of the value at 5% of
  the cost. Revisit in a year, not now.
- **Import from Screen Time / RescueTime.** High effort, tiny audience.

## 7.5 Priorities, in order

1. Fix YouTube attribution (data integrity — everything downstream depends on it).
2. Identity: name, palette, typography, copy, vocabulary.
3. Onboarding + create-a-rule-from-the-popup.
4. Delete: debugger, AI settings, video DB table, two tabs.
5. Promote the gate, the grid and refusals to hero status.
6. Personalisation: custom reflections, strictness presets.
7. Focus sessions and the weekly review.

---

# Part 8 — Competitive Analysis

| Product | Category | Their strength | Where Stoic beats them | Where they beat Stoic |
|---|---|---|---|---|
| **Freedom** | Blocker | Cross-device (Mac/Win/iOS/Android), scheduled sessions, locked mode | Nothing comparable to the friction gate or refusal tracking; Freedom is binary on/off | Everything infrastructural: multi-device, sync, real enforcement, a business |
| **Cold Turkey** | Blocker | Genuinely hard to bypass (OS-level), "Frozen Turkey" | Far better register and reflection; Cold Turkey is brutalist and ugly | Enforcement strength; Stoic is trivially disabled |
| **One Sec** | Mindfulness | One mechanic (breathe before opening), beautiful, viral | Stoic's gate is stronger and it keeps a real record; One Sec has almost no analytics | Focus and polish. It does one thing perfectly and is instantly explainable. **Its clarity is the standard Stoic should be measured against.** |
| **Opal** | Screen time | Superb visual identity, iOS-native, social proof | Desktop browsing depth; honest anti-engagement stance | Design maturity, brand, onboarding, monetisation |
| **RescueTime** | Tracker | Automatic categorisation across all apps, years of data, reports | Interventions (RescueTime mostly observes); YouTube-level granularity | Breadth (all apps, not just the browser), team features, maturity |
| **Forest** | Habit/gamified | Delightful, huge user base | Stoic's ledger is honest; Forest's tree is a token economy | Emotional design, delight, retention mechanics |
| **unhook / DF YouTube** | Feed surgery | Removes the recommendation feed — arguably the highest-leverage single intervention in this space | Stoic measures and gates; it doesn't reduce the temptation surface at all | **The one genuinely missing capability.** See below. |
| **Screen Zen / Minimalist Phone** | Digital wellbeing | Friction-first philosophy, very close to Stoic's thesis | Stoic's record-keeping is far deeper | Simplicity |

## 8.1 Where Stoic is genuinely unique

1. **The refusal metric.** No product in this list counts the times you turned
   back. It is the only metric that measures the decision instead of the
   consequence, and it is Stoic's most ownable idea.
2. **Symmetric friction** — loosening a rule costs exactly what breaking one does.
   Every competitor's settings page is the easy bypass.
3. **Content-level classification within a site.** A lecture and a prank video are
   the same YouTube minute to every competitor.
4. **Explicitly anti-engagement progression.** The T1–T6 tenets are a real
   position, not marketing.

## 8.2 Where Stoic is weakest

1. **Visual identity** — the weakest in the comparison set by a distance. Opal and
   One Sec are the bar, and Stoic is not near it.
2. **First-run experience** — competitors all have one; Stoic has none.
3. **Enforcement** — trivially bypassed, and honestly documented, but still a real
   ceiling on who it can serve.
4. **Scope** — browser-only, desktop-only.
5. **Reliability of its own headline analytic** (Part 5).

## 8.3 The one capability worth stealing

**Feed suppression, in the Stoic register.** unhook proves that hiding the
YouTube homepage feed and sidebar recommendations is the highest-leverage
intervention available in a browser, and Stoic already ships a YouTube content
script with DOM access. A *single, non-configurable* option — "Hide YouTube's
recommendation feed" — would fit the philosophy exactly (reduce the temptation
surface rather than fight it), cost far less than the current AI settings card,
and be more valuable than half the analytics. This is the strongest new-feature
candidate in the report, and the only one I would argue for before the backlog
below is complete. **Do not** turn it into a configurable feed-editor; that is
unhook's product, not Stoic's.

---

# Part 9 — Brutal Critique

*Written as an investor deciding whether to back this.*

## What feels amateur

- Shipping a **developer debugger in the consumer popup** with rows labelled
  "Cache Status: MISS". This is the single loudest amateur signal in the product.
- Exposing internal storage keys to users: **"Channel Database (yt_channels)"**,
  **"Extracted Video Database (yt_videos)"**, `domain_rule`, `manual_channel`.
- **~30 inline `style=` attributes** in `options.html` alongside a well-built token
  system. Someone built a design system and then didn't use it.
- **A README that documents features that no longer exist** — onboarding,
  quick-add chips, in-popup editing, Enter-to-save. It reads as a product whose
  author lost track of it.
- **Fetching favicons from Google and fonts from Google** in a product whose
  central promise is that nothing leaves your device. Nobody will read the code —
  but if one person does, the trust proposition is gone.
- The **extension's own name** contains "Site Time Limiter".
- An **AI settings card with an API-key field and a confidence slider** shipped to
  end users.
- **Three copies of the same brand SVG** at three sizes with three gradient IDs.

## What feels generic

- The palette, comprehensively. `#0284c7` is Tailwind's default sky. Six semantic
  hues. Gradient buttons with glow shadows and hover lifts. Inter. Rounded-square
  logo with a diagonal gradient. Every one of these was a 2021–2023 default.
- The options page IA — Overview / Analysis / Categories / Settings / Backup is
  the shape of every admin panel ever built.
- "Behaviour Summary" with three stat counters, one of which is a flattering
  estimate coloured green.

## What feels inconsistent

- Four voices (§1.4) and three names for the same concept (§1.4 table).
- "DISCIPLINE HELD" on the failure page.
- A theme toggle in the popup (binary) and a theme control in Preferences
  (ternary) that can disagree.
- A restraint mode advertised as deliberately non-configurable, in a product
  whose stated long-term goal is deep personalisation.
- Progression's design register (restrained, anti-shame) vs. the block page's
  ("You're about to throw away your focus again").

## What feels memorable

- The friction gate. Genuinely. Sixty seconds you cannot skip, two consecutive
  hard puzzles, and a written reason — and the *same* gate guards the settings
  page. I have not seen a competitor do the second part.
- "Turned back from this site: 14 times."
- The reflections. All fourteen are good, which is rare.
- `docs/progression/01-PRODUCT-DESIGN.md`. The rejected-mechanics section alone is
  better product thinking than most shipped consumer apps demonstrate.

## What I would remove today

The debugger (both surfaces), the AI settings card, the video database table, the
Categories tab, the Backup tab, the confidence slider, the auto-classify toggle,
the "Time Saved" metric, the popup theme toggle, three of six semantic hues, all
three gradients, and the README.

## What deserves more attention than it gets

The gate. The grid. Refusals. Onboarding. The store listing. The word "Stoic".

## The biggest weakness

**The product doesn't look or sound like what it is.** A user who never opens
`docs/` experiences a blue analytics dashboard with an unusually harsh block
page. All of the originality is either in a markdown file or buried three clicks
deep. The gap between how good the thinking is and how ordinary the surface is
the defining problem here — and, encouragingly, it is a design problem, not a
technical one.

Close behind, and more urgent: **the headline analytic is silently wrong** (Part 5),
and it has been quietly poisoning a ledger that is explicitly designed never to be
recomputed.

## The biggest opportunity

**Stoic is one visual identity and one onboarding away from being the only product
in its category with a real point of view.** The behavioural design is already
finished and it is better than the competition's. Nobody owns "the calm, honest,
uncompromising one". Opal owns pretty. Cold Turkey owns brutal. Freedom owns
everywhere. The position is open, and Stoic has already done the hard part.

---

# Part 10 — Recommendations (full detail)

Format per the brief. Difficulty: Trivial <30m · Small 30m–2h · Medium 2–6h ·
Large 1–2 sessions · Major multi-session.

---

### R1 — Fix YouTube metadata durability

**Problem.** Per-tab YouTube metadata lives in a module-level object in an MV3
service worker (`background.js:268`) that Chrome evicts every ~30s idle; the
content script never re-sends because it dedupes on an unchanged hash.
**Why it matters.** Watch time silently books to `BROWSE_KEY` → Leisure,
corrupting focus score → Daily Standard → XP → streaks → achievements →
permanently frozen ledger days.
**Solution.** Move the map to `chrome.storage.session`; add a `REQUEST_METADATA`
pull path from background → content script; re-broadcast on ping and
`visibilitychange`; `executeScript` into open YouTube tabs on `onInstalled`.
**Impact.** Correct numbers — the precondition for the entire progression system
being meaningful. **Difficulty:** Medium. **Best for:** Sonnet.
**Dependencies:** none. **Risk:** medium (touches the tick path — needs tests).

### R2 — Scope YouTube channel extraction; never guess

**Problem.** `youtube-content.js:81` falls back to the first `a[href*='/@']` in
the document, matching sidebar recommendations. Shorts have no
`h1.ytd-watch-metadata`.
**Why it matters.** Produces *confidently wrong* channels, which are cached and
written to the video DB — worse than a null.
**Solution.** Restrict selectors to owner containers; add Shorts-specific
selectors; return `null` rather than guessing.
**Impact.** Eliminates the misclassification class of failure.
**Difficulty:** Small. **Best for:** Sonnet. **Dependencies:** R1 (same file).
**Risk:** low.

### R3 — Decide and test the "no metadata" bucket

**Problem.** `attributionKeyForContext(null)` → `BROWSE_KEY` → Leisure, by
accident rather than by decision.
**Why it matters.** Defines what happens in the residual failure cases after R1/R2.
**Solution.** Introduce an explicit `unattributed` bucket that resolves to
General, not Leisure, and surface it in the category breakdown so it is visible
rather than silently pessimistic. Add tests.
**Impact.** Honest numbers under uncertainty — squarely on-brand.
**Difficulty:** Small. **Best for:** Human decision, then Sonnet.
**Dependencies:** R1. **Risk:** low.

### R4 — Delete the debugger (both surfaces) and the AI settings card

**Problem.** A developer tool and an API-key form shipped to end users.
**Why it matters.** Biggest single identity/credibility drag; also removes a
remote-network surface that contradicts the local-only promise.
**Solution.** Delete `popup.html:105-150`; delete the `tab-youtube-debug` panel;
move the channel classification table under Rules retitled "What counts as what";
keep the precedence trace as a console log behind a debug flag.
**Impact.** Large perceived-quality gain; ~700 lines of HTML/JS removed.
**Difficulty:** Medium. **Best for:** Sonnet. **Dependencies:** R1–R3 should land
first (don't remove the window before fixing the view). **Risk:** low.

### R5 — Replace the debugger with a "Why was this counted as X?" affordance

**Problem.** Users have a real need — "I don't trust this number" — that the
debugger served badly.
**Solution.** A small "Why?" control on YouTube rows in the domain audit table
and category breakdown; opens a one-sentence plain-language explanation plus an
inline "Classify this channel" action.
**Impact.** Serves the actual need at a fraction of the surface.
**Difficulty:** Medium. **Best for:** Sonnet. **Dependencies:** R4. **Risk:** low.

### R6 — Replace the colour system

**Problem.** Tailwind sky + six semantic hues + three gradients + hardcoded blue
glows.
**Solution.** The Limestone/Basalt palette (§2.1). Four semantic roles
(`held`/`partial`/`missed`) plus `earned` (bronze) for progression only. Delete
blue/purple/cyan families and all `--grad-*`. Fix the two hardcoded
`rgba(2,132,199,…)` shadows in `components.css`.
**Impact.** The largest single change to how the product feels.
**Difficulty:** Medium. **Best for:** Human sign-off on the palette → Sonnet to
apply. **Dependencies:** none. **Risk:** medium — every surface changes at once;
must be done in one pass or it will look broken mid-flight.

### R7 — Self-host fonts, kill CDN calls, kill Google favicons

**Problem.** `fonts.googleapis.com` referenced from `tokens.css:1` and all three
HTML files; favicons fetched from `google.com/s2/favicons` in `popup.js:131` and
`options.js:486`.
**Why it matters.** Directly contradicts "nothing leaves your device", breaks
offline, and the favicon call leaks the user's top domains to Google on every
popup open. Also a Web Store review risk.
**Solution.** Ship `woff2` in `/fonts` with one `@font-face` block; use the tab's
own `favIconUrl` or a monogram fallback.
**Impact.** Restores the core promise; faster, offline-correct rendering.
**Difficulty:** Small. **Best for:** Sonnet. **Dependencies:** none. **Risk:** none.
**Note: do this early — it is cheap and it is a promise violation.**

### R8 — Typographic system + one serif voice

**Problem.** Fifteen ad-hoc font sizes; no signature.
**Solution.** Eight-step scale as tokens; forbid off-scale values; introduce one
self-hosted serif used **only** for block-page reflections and rank descriptors;
narrow the mono to numerals and the ledger.
**Impact.** Hierarchy legibility + a recognisable screenshot.
**Difficulty:** Medium. **Best for:** Human picks the serif → Sonnet applies.
**Dependencies:** R7. **Risk:** low.

### R9 — Elevation, radii, motion cleanup

**Problem.** 5 shadows + 5 radii + decorative hover lifts + one reduced-motion query.
**Solution.** 2 shadows, 3 radii, borders over shadows, delete hover lifts on
non-interactive elements, global `prefers-reduced-motion` block.
**Impact.** Calmer, more coherent surfaces. **Difficulty:** Small.
**Best for:** Sonnet. **Dependencies:** R6. **Risk:** none.

### R10 — Glossary and copy pass

**Problem.** Three names per concept; four voices; "DISCIPLINE HELD" on failure
pages; a shaming restraint headline.
**Solution.** Write a one-page glossary (one word per concept) and a copy brief
(the four emotions in §1.2). Apply across manifest, all HTML, all user-facing
strings. Fix the eyebrows. Rewrite the restraint headline in the calm register.
**Impact.** Very high per hour — this is where most of the "identity" gap closes.
**Difficulty:** Medium. **Best for:** Human writes the glossary + hero strings →
Sonnet applies mechanically. **Dependencies:** none. **Risk:** none.

### R11 — Rename the extension and rewrite the store description

**Problem.** `"Stoic - Site Time Limiter"`.
**Solution.** `"Stoic"`, with a description that leads with the gate and the
record, not with time limits.
**Impact.** Top-of-funnel. **Difficulty:** Trivial. **Best for:** Human.
**Risk:** none.

### R12 — First-run onboarding

**Problem.** None exists; `<all_urls>` is unexplained; the README claims otherwise.
**Solution.** Three dismissible popup panels: what it is / why it needs every site
+ the local-only promise / set your first rule on the current tab.
**Impact.** Highest of any UX item. **Difficulty:** Medium.
**Best for:** Human copy → Sonnet. **Dependencies:** R13, R10. **Risk:** low.

### R13 — "Limit this site" from the popup

**Problem.** Creating a rule takes 7 steps and a tab switch; the current domain is
never offered.
**Solution.** Current-domain row + inline compact form (mode / minutes / save) in
the popup; Enter-to-save; "Open Dashboard" demoted to a link.
**Impact.** Very high — restores the product's primary action.
**Difficulty:** Medium. **Best for:** Sonnet. **Dependencies:** none. **Risk:** low.

### R14 — Options IA: 8 tabs → 4

**Problem.** Overlap, a one-card tab, a three-card tab, a mislabelled tab, a
developer tab.
**Solution.** Today / Record / Rules / Settings (§3.3).
**Impact.** High. **Difficulty:** Large. **Best for:** Sonnet after human IA
sign-off. **Dependencies:** R4. **Risk:** medium.

### R15 — Fix the tablist keyboard pattern

**Problem.** ARIA roles declared, behaviour not implemented.
**Solution.** Roving tabindex, arrow/Home/End, `aria-controls`.
**Difficulty:** Small. **Best for:** Sonnet. **Dependencies:** R14 (do it in the
same pass). **Risk:** none.

### R16 — Loading, empty and error states

**Problem.** No loading states (zeros paint first), two empty states, no
`aria-live` anywhere.
**Solution.** A shared skeleton/placeholder; empty states for all seven missing
surfaces; one polite `aria-live` region per page for save/sync/import feedback.
**Impact.** Removes the misleading "0m / 100% focus" flash and makes the first
run comprehensible. **Difficulty:** Medium. **Best for:** Sonnet.
**Dependencies:** R6. **Risk:** low.

### R17 — Prune the tracked-domain ledger; fix the sync trap

**Problem.** `sites` grows unbounded; the sync toggle will exceed the 8 KB
per-item quota; no user-facing view or per-domain delete.
**Solution.** Prune unconstrained entries idle >14 days with no rule; sync **rules
and preferences only**; add a "Tracked domains" list with delete; state the
tracking plainly in onboarding.
**Impact.** Prevents a real failure mode and closes a trust gap.
**Difficulty:** Medium. **Best for:** Sonnet. **Dependencies:** R12 (for the
disclosure copy). **Risk:** medium (storage layer — needs tests).

### R18 — Promote the grid, refusals and the gate

**Problem.** The three most differentiated elements are buried.
**Solution.** Contribution grid becomes the hero of Record. Lifetime refusals get
a first-class cell in the popup and on Today. The gate is described at rule
creation ("changing this later will cost you the same 60 seconds").
**Impact.** High identity gain, low effort. **Difficulty:** Small–Medium.
**Best for:** Sonnet. **Dependencies:** R14. **Risk:** low.

### R19 — Custom reflections and gate questions

**Problem.** The most personal surface in the product is a hardcoded array.
**Solution.** User-added lines merged into the rotation; built-ins hideable;
managed from Settings.
**Impact.** The single highest personalisation-value item.
**Difficulty:** Small. **Best for:** Sonnet. **Dependencies:** R14. **Risk:** low.

### R20 — Per-rule strictness presets

**Problem.** Gate difficulty is three global constants; the modal says it is
deliberately unconfigurable.
**Solution.** Light / Standard / Severe presets (wait, puzzle count, reason
length) chosen per rule. Presets, never sliders.
**Impact.** Removes the top reason a user abandons restraint mode.
**Difficulty:** Medium. **Best for:** Human decision on the three tiers → Sonnet.
**Dependencies:** R14. **Risk:** low.

### R21 — Fix the block page's "Go back" loop and `timesTripped` inflation

**Problem.** `history.back()` can return to the same site and re-trip; each trip
increments an all-time counter shown to the user.
**Solution.** Close the tab / go to newtab instead; debounce re-trips within 60s.
**Difficulty:** Small. **Best for:** Sonnet. **Risk:** low.

### R22 — Reconcile "Reset All Data" copy with behaviour

**Problem.** Progression state survives a reset the copy says is total.
**Solution.** Either state that the record is kept, or add a second,
separately-gated "Erase my record".
**Difficulty:** Trivial–Small. **Best for:** Human decision. **Risk:** none.

### R23 — Delete or justify "Time Saved"

**Problem.** An estimate rendered as a hard green number in a product about
honest measurement.
**Solution.** Show the derivation on hover, or remove it.
**Difficulty:** Trivial. **Best for:** Human decision. **Risk:** none.

### R24 — Resolve `schedule.dayLimits`

**Problem.** Weekday/weekend limits exist in the data model and in
`limitMinutesForDate` but have no UI.
**Solution.** Build the UI in the schedule disclosure, or delete the code path
and its tests.
**Difficulty:** Small (delete) / Medium (build). **Best for:** Human decision.
**Risk:** low.

### R25 — Rewrite or delete the README

**Problem.** Documents onboarding, quick-add chips, in-popup editing, Enter-to-save
and per-row charts — none of which exist.
**Difficulty:** Small. **Best for:** Sonnet, last, once the product has stopped
moving. **Risk:** none.

### R26 — (New feature, argued for) YouTube feed suppression

**Problem.** Stoic measures and gates but never reduces the temptation surface.
**Solution.** One non-configurable option: hide the YouTube home feed and sidebar
recommendations. Uses the existing content script.
**Impact.** Potentially the highest behavioural impact per line in the report.
**Difficulty:** Medium. **Best for:** Sonnet. **Dependencies:** R1/R2 (same file).
**Risk:** medium (YouTube DOM churn — needs a maintenance expectation set).
**Note:** this is scope growth. It is the *only* new feature I would add before
the deletions are complete, and only because it is cheap and squarely on-thesis.

---

# Part 11 — Implementation Backlog, Grouped Into Sonnet Sessions

Nine sessions. Ordered so that data-correctness precedes anything cosmetic, and
deletions precede redesigns (never redesign something you are about to delete).

---

## Session 1 — YouTube attribution correctness

**Objective.** Make YouTube watch-time attribution survive service-worker
eviction and stop producing confidently-wrong channels.
**Scope.** R1, R2, R3.
**Files.** `youtube-content.js`, `background.js`, `youtube-classifier.js`,
`manifest.json` (possibly `scripting` permission), `test/youtube-attribution.test.js` (new),
`test/youtube-integration.test.js`.
**Time.** 4–6h. **Tokens.** Medium. **Confidence in one conversation: High.**
**Independent:** yes. **Group with:** nothing — this must land alone and green.
**Acceptance.** New tests cover worker restart with a live tab, Shorts, playlist
autoplay, and the no-metadata bucket. `npm test` green.

## Session 2 — Deletions

**Objective.** Remove the debugger, the AI settings card, the video DB table, and
the dead `dayLimits` path if that decision is "delete".
**Scope.** R4, R24 (if delete), plus removing the AI provider/threshold/auto-classify
code paths in `options.js` and `youtube-classifier.js`.
**Files.** `popup.html`, `popup.js`, `options.html`, `options.js`,
`youtube-classifier.js`, `test/ai-classification.test.js`,
`test/youtube-custom-provider.test.js`.
**Time.** 3–4h. **Tokens.** Medium. **Confidence: High.**
**Independent:** yes (after Session 1). **Group with:** nothing.
**Note.** Deleting tests is part of this session — a test suite for removed
features is a maintenance tax, and `npm test` must be green at the end.

## Session 3 — Design foundations

**Objective.** Replace the colour system, self-host fonts, kill external calls,
install the type scale, cut shadows/radii/motion.
**Scope.** R6, R7, R8, R9.
**Files.** `tokens.css`, `components.css`, `popup.css`, `options.css`,
`blocked.css`, `progression.css`, `popup.js`/`options.js` (favicon code), all three
HTML `<head>`s, new `/fonts`.
**Time.** 5–6h. **Tokens.** **Large.** **Confidence: Medium.**
**Independent:** yes. **Group with:** must be one atomic pass — a half-migrated
palette looks broken.
**Split if needed:** 3a = tokens + fonts + external-call removal (mechanical);
3b = per-surface CSS reconciliation + inline-style cleanup in `options.html`.
Prefer splitting; this is the session most likely to run out of context.
**Acceptance.** Zero references to `fonts.googleapis.com`, `google.com/s2`,
`--sem-blue/purple/cyan`, `--grad-*`, or hardcoded `rgba(2,132,199,…)`.

## Session 4 — Copy, glossary, naming

**Objective.** One vocabulary, one voice, correct eyebrows, new manifest name.
**Scope.** R10, R11, R5's copy, the restraint headline rewrite.
**Files.** `manifest.json`, all three HTML files, `blocked.js`, `options.js`,
`popup.js`, new `docs/GLOSSARY.md`.
**Time.** 3–4h. **Tokens.** Medium. **Confidence: High** *provided a human writes
the glossary and the ~10 hero strings first.* Without that input, Low — Sonnet
will invent a voice, which is exactly what produced the current inconsistency.
**Dependencies:** human input. **Group with:** Session 3 if both are small.

## Session 5 — Popup redesign + onboarding

**Objective.** Make the popup the place where rules are created, and give new
users a first run.
**Scope.** R13, R12, R18 (popup half — refusal count).
**Files.** `popup.html`, `popup.js`, `popup.css`, `background.js` (active-tab
domain message), `common.js`.
**Time.** 5–6h. **Tokens.** Large. **Confidence: Medium.**
**Split if needed:** 5a = "limit this site" inline form; 5b = onboarding panels.
**Dependencies:** Sessions 3 and 4 (so the new surface is built in the new
language, not retrofitted).

## Session 6 — Options IA restructure

**Objective.** 8 tabs → 4, with the grid promoted and the keyboard pattern fixed.
**Scope.** R14, R15, R18 (Record half).
**Files.** `options.html`, `options.js`, `options.css`, `progression-ui.js`.
**Time.** 6h+. **Tokens.** **Large.** **Confidence: Medium–Low as one session.**
**Split — recommended:** 6a = new tab shell, navigation, keyboard pattern, and
moving existing panels wholesale; 6b = within-tab hierarchy (grid as hero,
achievements collapsed, lifetime as a definition list, channel table relocated
under Rules).
**Dependencies:** Sessions 2, 3.

## Session 7 — States and storage hygiene

**Objective.** Loading/empty/error states everywhere; prune the domain ledger;
fix the sync trap; block-page navigation and counter fixes.
**Scope.** R16, R17, R21, R22.
**Files.** `components.css`, `options.js`, `options.html`, `popup.js`,
`blocked.js`, `background.js`, `common.js`, `test/common.test.js`,
`test/background-logic.test.js`.
**Time.** 5–6h. **Tokens.** Large. **Confidence: Medium.**
**Split if needed:** 7a = states (pure UI); 7b = storage/pruning/sync (needs tests).
**Dependencies:** Session 6.

## Session 8 — Personalisation

**Objective.** Custom reflections and gate questions; per-rule strictness presets.
**Scope.** R19, R20.
**Files.** `common.js`, `blocked.js`, `options.html`, `options.js`,
`options.css`, `test/restraint.test.js`.
**Time.** 4–5h. **Tokens.** Medium. **Confidence: High.**
**Dependencies:** Sessions 6, 7.

## Session 9 — Feed suppression + documentation

**Objective.** The one new feature, plus a truthful README.
**Scope.** R26, R25, R23.
**Files.** `youtube-content.js`, a new `youtube-feed.css`, `options.html`,
`options.js`, `README.md`.
**Time.** 4h. **Tokens.** Medium. **Confidence: Medium** (YouTube DOM selectors
are inherently brittle; budget for revisits).
**Dependencies:** everything else stable.

---

# Part 12 — Final Deliverables

## Executive Summary

Stoic v2.3.0 is a technically sound, philosophically original product wearing a
generic skin, with one silent data-integrity defect that undermines its most
ambitious subsystem.

The engineering is better than it looks: pure logic is separated for testability
(`background-logic.js`, `progression-model.js`), 215 tests pass, elapsed-time
accounting is genuinely careful, the classification precedence chain resolves at
read time so re-classification retroactively corrects history, and the
progression system is specified to a standard most teams never reach. The
friction gate — sixty unskippable seconds, two consecutive puzzles, a written
reason, applied equally to opening a blocked site *and* to loosening a rule — is
a real, defensible, uncopied idea.

None of that reaches the user. The product presents as an eight-tab blue
analytics dashboard whose third visible element is a developer debugger reading
"Cache Status: MISS", with no onboarding, no way to create a rule from the popup,
an unexplained `<all_urls>` permission, and a block page that congratulates the
user at the moment they failed. Meanwhile YouTube watch-time attribution silently
collapses to "Leisure" whenever the service worker is evicted — which is
constantly — permanently corrupting a ledger designed never to be recomputed.

The gap between the quality of the thinking and the quality of the surface is the
whole story here. Closing it is a design and deletion exercise, not a rebuild.

## Top 10 Highest-Impact Improvements (ranked)

1. **Fix YouTube attribution durability** (R1–R3). Everything downstream is
   currently being poisoned, permanently.
2. **Replace the colour and type system** (R6–R9). The largest single change to
   what the product *is*, perceptually.
3. **"Limit this site" from the popup** (R13). Restores the product's primary
   action, currently 7 steps away.
4. **First-run onboarding with the permission rationale** (R12). Highest-leverage
   UX gap; also where the philosophy should land first.
5. **Delete the debugger and the AI settings card** (R4). ~700 lines out, and the
   single loudest amateur signal gone.
6. **Glossary + copy pass + rename** (R10, R11). Most identity gained per hour.
7. **Self-host fonts, drop Google favicon calls** (R7). Cheap; the current state
   is a stated-promise violation.
8. **8 tabs → 4** (R14). Removes the "generic admin console" read.
9. **Promote the grid, refusals and the gate** (R18). The differentiators are all
   buried below the fold.
10. **Custom reflections** (R19). The highest personalisation-value-per-hour item
    in the product.

## Features To Remove

| Feature | Why |
|---|---|
| Classification Debugger (popup) | Developer tool in the consumer surface; leaks internal vocabulary; third thing a new user sees |
| Classification Debugger (options tab) | Same, plus it occupies top-level navigation |
| Custom remote AI API (key + endpoint) | Breaks the local-only promise, unusable by normal users, security surface, Web Store risk |
| AI confidence threshold slider | Exposes an opaque internal score as a user setting |
| Auto-classify toggle | Should always be on |
| Video database table | An admin log of every video watched; keep the data, delete the surface |
| Categories tab | One card; belongs inside Record |
| Backup tab | Three cards; belongs inside Settings |
| Popup theme toggle | Duplicate of the Preferences control, with a different value set |
| "Time Saved" metric | A flattering estimate shown as fact, in a product about honest measurement |
| `--sem-blue/purple/cyan`, all `--grad-*` | No semantic role; contradict the register |
| Decorative hover lifts on non-interactive elements | Imply interactivity that doesn't exist |
| The current README | Documents features that no longer exist |

## Features To Postpone

| Feature | Why postpone |
|---|---|
| **Focus sessions / temporary max strictness** | Genuinely valuable and on-thesis, but it is new scope. Ship after the deletions and the identity work, or it inherits the current design language. |
| **Weekly review moment** | Strong idea, needs the Record tab to exist first. |
| **Year-in-review / printable ledger export** | Meaningless until the ledger has a year in it *and* the data is correct (Session 1). |
| **Rank-vocabulary choice** | Wait for evidence that the current ladder reads wrong to real users. |
| **On-device LLM classification** | Heuristic + one-tap correction covers ~90% of the value; revisit in a year. |
| **Achievement trimming** | Needs real usage data to see which of the 27 never fire. |

## Features To Merge

| Merge | Into | Why |
|---|---|---|
| Block mode + Restraint mode | One "Restraint" with a strictness level | They are the same feature at two friction levels; three modes in a segmented control is a false choice |
| Overview tab + "today's standing" from Progress | **Today** | Two tabs answering the same question |
| Detailed Analysis + Categories + the rest of Progress | **Record** | One place for "what has actually happened" |
| Preferences + Backup + Danger Zone | **Settings** | Occasional maintenance belongs together |
| Channel classification table | **Rules** | It *is* a rule about what counts as what |
| Popup theme toggle + Preferences theme control | One control in Settings | Two controls, one setting, divergent value sets |
| Milestones + achievements | Already correctly merged in the design docs | Keep it that way |

## Sonnet Implementation Order

```
1. Session 1 — YouTube attribution correctness      (blocking; data integrity)
2. Session 2 — Deletions                            (never redesign what you'll delete)
3. Session 3 — Design foundations   [split 3a/3b]   (needs human palette sign-off)
4. Session 4 — Copy, glossary, naming               (needs human glossary first)
5. Session 5 — Popup + onboarding   [split 5a/5b]
6. Session 6 — Options IA           [split 6a/6b]   (needs human IA sign-off)
7. Session 7 — States + storage hygiene [split 7a/7b]
8. Session 8 — Personalisation
9. Session 9 — Feed suppression + README
```

## Estimated Number of Sonnet Sessions

**Realistically 12–14 conversations**, not 9. Sessions 3, 5, 6 and 7 should each
be planned as two — they are the ones with both breadth and cross-file coupling,
and the existing `docs/progression/HANDOFF.md` already documents (correctly) that
attention degrades across long single-session output with silent failure modes.
Budget:

- 9 nominal sessions
- +4 from the recommended splits (3a/3b, 5a/5b, 6a/6b, 7a/7b)
- +1 for a final consistency/regression pass across all four surfaces

Plus **2–3 human working sessions** *before* Sonnet starts on Sessions 3 and 4:
palette sign-off, glossary + hero copy, IA sign-off.

## Opus-Level Tasks

Only these genuinely need the larger model; everything else is well-specified
execution that Sonnet will do faster and cheaper.

1. **The palette and typographic system decision** (R6, R8) — a synthesis
   judgement across brand, accessibility, dark mode and six existing surfaces.
   The *application* is Sonnet's job; the *decision* is not.
2. **The glossary and copy brief** (R10) — requires holding the whole product's
   voice in mind at once. This is the task most likely to be done badly by
   pattern-matching, and it is the one with the highest identity leverage.
3. **The information architecture decision** (R14) — which tab each of ~20
   existing panels belongs in, and what gets cut in the process.
4. **The no-metadata bucket semantics** (R3) — a product decision about what the
   product asserts under uncertainty, which touches the frozen-ledger invariant.
5. **Strictness preset design** (R20) — three tiers that stay a stance rather
   than becoming a slider; this is where the philosophy is easiest to erode.
6. **Whether to build feed suppression at all** (R26) — a scope decision with a
   permanent maintenance tail.

Everything else — including all of Sessions 1, 2, 7, 8, 9 — is Sonnet work.

## Overall Verdict

| Dimension | Score | Reasoning |
|---|---|---|
| **Product identity** | **4/10** | A genuinely original thesis, articulated brilliantly in `docs/` and almost nowhere in the UI. The name literally disclaims it. Four voices, three vocabularies. |
| **UX** | **4/10** | No onboarding, the primary action costs 7 steps, 8 tabs with real overlap, a broken ARIA pattern, no loading states, two empty states. The friction-gate flows themselves are excellent. |
| **UI** | **4/10** | Competent, consistent-ish, and completely generic. Gradient buttons, hover lifts, six accent hues, a developer panel in the popup. |
| **Design language** | **5/10** | A real token system exists and is well-structured — then bypassed by ~30 inline styles, 15 ad-hoc font sizes, 5 shadows and hardcoded accent colours. The bones are good; the discipline isn't. |
| **Feature quality** | **7/10** | Individual features are well-built and carefully reasoned. Too many of them, and one headline feature is silently broken. |
| **Cohesion** | **3/10** | The lowest score, deliberately. This is two products in one codebase, and the weaker one is in front. |
| **Originality** | **8/10** | The refusal metric, symmetric friction, read-time content classification, and the anti-engagement progression tenets are all genuinely novel in this category. |
| **Maintainability** | **8/10** | No build step, no framework, pure logic extracted for testing, 215 passing tests, documentation that explains *why*. Points off for the unbounded `sites` growth, three copies of the brand SVG, and dead code paths. |
| **Long-term potential** | **8/10** | The ledger is a real moat that compounds daily. The position ("the calm, honest, uncompromising one") is unoccupied. The remaining work is design, which is faster than the engineering already done. |

**Weighted overall: 5.5/10 today — with a credible path to 8+ in roughly a dozen
implementation sessions, none of which require new architecture.**

---

## Conclusion

Stoic today is a well-engineered personal tool that has quietly become two
products. The first — a philosophy product built around a friction gate that
respects the user enough to be genuinely hard, a metric that counts the times you
turned back, and a ledger that judges a day by whether you *held* rather than by
how much you produced — is original, defensible, and better thought through than
anything in its competitive set. The second — an eight-tab blue analytics
dashboard with a developer debugger in the popup, an API-key field, storage keys
in headings, and a block page that says "DISCIPLINE HELD" at the exact moment
discipline did not hold — is the one a new user meets. Every hour spent on the
second product is an hour spent burying the first.

Two things must change before Stoic can be exceptional. **First, the numbers must
be true.** The MV3 service worker drops its per-tab YouTube metadata every time
Chrome evicts it, the content script never re-sends, and the result is that
productive watch time is booked as leisure — which flows into the focus score,
the Daily Standard, XP, streaks, the grid and the achievement predicates, all of
which are frozen at settlement by design. A product whose entire value is honest
self-measurement cannot ship a headline analytic that is quietly wrong, and it
cannot repair the damage retroactively. This is the only item on the list that
gets worse every day it is deferred. **Second, the surface must say what the
product means.** Not through decoration — through subtraction: one palette drawn
from stone and oxidised metal instead of Tailwind's default sky, one type scale
with one serif reserved for when the product speaks in its own voice, one word per
concept, four tabs instead of eight, and eleven features deleted outright. The
philosophy already exists, fully formed, in `docs/progression/01-PRODUCT-DESIGN.md`
and in fourteen sentences in `blocked.js`. It does not need to be invented. It
needs to be let out of those two files.

If only four things get done, do these: **fix YouTube attribution; replace the
colour and type system; let the user create a rule from the popup with a first-run
explanation of why the extension can see every site; and delete the debugger.**
That is roughly five implementation sessions. It would move product identity from
4 to 7, UX from 4 to 7, and cohesion from 3 to 6 — without adding a single
feature, which is precisely the point.

The strongest signal in this entire audit is not any individual defect. It is
that a personal project produced a design document rigorous enough to reject
fourteen standard mechanics with reasons, and then shipped a UI that looks like
every other extension in the store. The thinking is already at the level the
product needs to reach. The surface simply hasn't caught up yet — and that is a
far better problem to have than the reverse.
