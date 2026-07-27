# Stoic — Site Time Limiter (Chrome Extension)

A calm, minimal extension for limiting or blocking distracting sites,
with an optional redirect and a reality-check block page designed to
actually make you close the tab.

## Install (unpacked)

1. Unzip this folder somewhere permanent (Chrome loads the extension from
   here — don't delete it later).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this `stoic` extension folder.
5. Pin **Stoic** from the toolbar puzzle-piece menu.

## Features

- **First-run onboarding** — a one-time, dismissible panel in the popup
  explaining what Stoic does and specifically why it needs access to
  every site (it watches your active tab locally to know when you've
  hit your limit; nothing leaves your device).
- **Quick-add chips** for YouTube, Instagram, X, Reddit, TikTok, Facebook,
  Netflix, and LinkedIn — tucked into a collapsible Quick add section so
  the main popup stays focused.
- **Two discipline types:** Moderation, a daily time limit (minutes/day),
  or Restraint, a full block.
- **Flexible schedules** per discipline:
  - Choose the active days of the week.
  - Optionally apply the discipline only during local focus hours.
  - For Moderation, optionally use different weekday and weekend minute
    limits while keeping one default daily limit.
  - Scheduling lives in the popup's **More options** section; unscheduled
    disciplines default to every day, all day.
- **Two "when resolve slips" actions:**
  - *Reality-check page* — a block page showing today's usage, this
    week's total, how many times the discipline has been tested, a
    rotating stoic-inspired reflection on discipline and focus (never
    the same one twice in a row), and a time-equivalency line (e.g.
    "that's close to a movie's runtime").
  - *Redirect elsewhere* — send the tab straight to another URL instead
    (e.g. a reading app, a to-do list, anything you'd rather be doing).
  - The action picker also lives under **More options**; the default is
    the reality-check page.
- **Pause/resume** a discipline without deleting it, for when you
  genuinely need temporary access.
- **Edit in place** — click any discipline row (or a quick-add chip for a
  site you already added) to load its settings back into the form.
- Press **Enter** in any field of the discipline form to save it —
  no need to reach for the mouse.
- **Dashboard** at the top of the popup: total time tracked today and
  how many disciplines are active.
- **7-day usage chart** on each discipline row, built from the rolling
  `history` array plus today's live counter, shown when you expand that
  row's details.
- **Supportive streaks** for Moderation disciplines, e.g. several
  scheduled days in a row within the limit. These are also in row
  details; off-schedule days do not break a streak.
- **Collapsed settings** for sync, export, and import, keeping everyday
  discipline work separate from occasional maintenance.
- Daily limits reset automatically at local midnight; a rolling 7-day
  view powers the popup charts and "this week" stats.
- Subdomains are matched automatically (adding `youtube.com` also covers
  `m.youtube.com`).

## Project structure

- `common.js` — shared helpers (`todayStr`, `getSites`/`saveSites`,
  `fmtMinutes`, schedule helpers, weekly usage, streak calculation), the
  category taxonomy, and the generic classification framework
  (extractors, the rule pipeline, analytics). Loaded via `<script>` in the
  HTML pages and via `importScripts()` in the background service worker.
- `youtube-classifier.js` — the YouTube classification domain service:
  channel database, per-video database, prediction providers, the
  precedence chain, and watch-time attribution. It plugs into `common.js`
  through `registerClassifierRule` / `registerContentService`, so the
  dependency only points one way and `common.js` stays platform-agnostic.
  Must load *after* `common.js`.

### YouTube classification precedence

Every watched video resolves to exactly one category — Productive,
General Browsing, or Leisure — through a single chain in
`resolveYouTubeClassification()`:

1. **Explicit video override** — the user classified that exact video.
2. **Explicit channel classification** — the user pinned the channel, or
   it is in the shipped `BUILT_IN_CHANNEL_CLASSIFICATIONS` table. This is
   final: no prediction runs for a pinned channel.
3. **Site-level override** — a category set on `youtube.com` itself.
4. **Predicted channel classification** — the prediction system's settled
   answer for the channel.
5. **Prediction from the video's own title** — for a channel that is new
   or that the predictor could not resolve.
6. **Generic `youtube.com` domain rule** — Leisure · Streaming.

Watch time is credited per video (not per category) and the category is
resolved at read time, so re-classifying a channel retroactively corrects
the day's focus score and analytics rather than only affecting what you
watch next.
- `tokens.css` — color/type variables and the handful of resets every
  surface needs.
- `components.css` — shared UI pieces (buttons, form fields, the
  segmented control, the stat grid, the callout panel) defined once and
  reused by both `popup.html` and `blocked.html`.
- `popup.css` / `blocked.css` — layout and styling specific to that one
  surface.

## Notes / limitations

- Time is tracked only while a matching tab is the active tab in a
  focused window and the discipline is currently inside its schedule.
  Usage is measured from real elapsed time between checks (not a flat
  per-check credit), so it stays accurate whether Chrome fires the
  tracking alarm every 5 seconds (unpacked/dev mode) or every ~30
  seconds (the minimum Chrome enforces once the extension is
  packed/published) — it doesn't count background/minimized time.
- By default, all data is stored locally via `chrome.storage.local`.
  The popup includes an opt-in sync toggle that moves the same `sites`
  data to `chrome.storage.sync`; Chrome's sync quota is modest, so large
  histories or many disciplines may be better kept local.
- Old saved disciplines that do not have a `schedule` field are treated
  as active every day, all day, with their existing daily limit.
- This is a personal productivity tool, not tamper-proof: since it's an
  unpacked dev extension, it can be disabled from `chrome://extensions`
  by anyone with access to the browser. For stricter, harder-to-bypass
  enforcement you'd want a managed/enterprise Chrome policy instead.
