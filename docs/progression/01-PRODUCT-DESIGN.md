# Progression System — Product Design

Depends on: `00-AUDIT.md`.
This document decides *what* is built and *what is deliberately not built*.
`02-ARCHITECTURE.md` decides how.

---

## 1. Philosophy

Stoic's product thesis is inverted from every app that has a progression system.
Duolingo, Strava and GitHub reward you for **doing more of the thing**. Stoic
exists to help you **do less of the thing**. A progression system copied naively
from those products would optimise directly against the product's purpose.

Six tenets constrain every mechanic below. A mechanic that violates one is cut,
regardless of how well it works elsewhere.

**T1 — Reward the decision, never the volume.**
No XP is ever awarded for time spent, sites visited, videos classified, or the
dashboard being opened. XP attaches to choices: a day closed within its limits, a
gate turned away from. If a mechanic pays out more when the user browses more,
it is wrong.

**T2 — Progress is monotonic. Nothing is ever taken away.**
XP never decreases, levels never drop, achievements are never revoked. The
absence of a day's award *is* the consequence of a bad day. Negative XP would
turn the number into a shame object, and shame is not a durable behaviour-change
mechanism — it is the emotional loop the feeds already exploit.

**T3 — No manufactured urgency.**
Zero notifications from the progression system. No "your streak is at risk", no
daily login reward, no rotating quests, no expiring bonuses. Stoic's only
notifications are the 80%/90% limit warnings and they stay that way. A product
that reduces compulsion cannot introduce a new compulsion to check it.

**T4 — Legibility over cleverness.**
Every number must be explainable in one sentence, and the UI must show that
sentence. No hidden multipliers, no opaque scoring, no randomness. The user
should be able to predict roughly what a day earned before opening the tab.

**T5 — Retrospective, not prospective.**
The system reports what you did; it does not dangle carrots for what you might
do. Rank titles are earned descriptions of past behaviour, not goals. This is why
the bulk of XP settles at the end of a day rather than accruing live: a completed
day is a closed book that can be judged honestly.

**T6 — A day away from the browser is a good day, not a missed day.**
Absence never breaks a streak, never costs XP, never counts as a failure. This
one tenet rules out roughly half of the mechanics common in the category.

**Tone.** The register is that of a training log or a ledger, not a game.
Restrained typography, semantic colour already in `tokens.css`, no confetti, no
mascots, no exclamation marks. The existing block-page copy ("Discipline is just
clarity, held a little past the point where it stops feeling urgent") is the
voice to match.

---

## 2. Mechanics — accepted, with justification

Each entry answers the five required questions.

### 2.1 XP ("Discipline earned")

- **Why it should exist.** A single scalar is the only way to make heterogeneous
  good behaviour — holding a limit, keeping leisure down, turning back at a gate —
  comparable and cumulative. Without it, levels and long-term progression have no
  substrate.
- **Behaviour reinforced.** Closing a day inside its constraints; consistency
  across days rather than heroic single days.
- **Data.** Already exists. Day totals come from `entryCategorySegments` +
  `calculateFocusScore` + `getActiveRule`. The only new inputs are the two gate
  events, which `background.js` already produces and discards.
- **Complexity.** Low. A pure function over one day's snapshot.
- **Fits Stoic?** Only in the redefined form below. "XP per minute of productive
  time" would violate T1 and is rejected in §3.

### 2.2 The Daily Standard (three conditions)

Rather than a configurable goal system, one fixed standard defines a good day.
Every user has it, whether or not they have configured any rules.

| | Condition | Met when | Waived when |
|---|---|---|---|
| **C1** | **Adherence** | No active rule was violated. A violation is: a `limit` rule exceeded on a scheduled day, or a `restraint`/`block` rule pushed through. | Vacuously true if the user has no active rules. |
| **C2** | **Restraint** | Leisure macro-category time ≤ the leisure ceiling (default **60 min**, user-adjustable 15–240). | Never — everyone has leisure measured. |
| **C3** | **Focus** | Focus score ≥ **60** (user-adjustable 40–90). | Waived (counts as met) on a day with < 30 min tracked. A day barely spent at the browser is not a day of poor focus. |

**Day held** = C1 ∧ C2 ∧ C3. This is the unit the streak, the grid, the weekly
standard and most achievements are all defined on — one concept, reused
everywhere, rather than four parallel goal systems.

- **Why.** It gives users with zero rules a meaningful bar (C2, C3) and users with
  many rules credit for keeping them (C1). It is a *ceiling* goal, satisfied by
  doing less, which is the only goal shape compatible with T1.
- **Data.** All existing.
- **Fits Stoic?** Yes. It is the product's own definition of a good day, made explicit.

### 2.3 Levels and ranks

- **Why.** Levels convert a large, meaningless XP number into a legible position
  on a long path, and give long-term users something that keeps moving after the
  achievement list is exhausted.
- **Behaviour reinforced.** Persistence over months; nothing day-to-day.
- **Data.** Derived from cumulative XP only.
- **Complexity.** Trivial (a closed-form curve).
- **Fits Stoic?** Yes if the presentation is mature: no "LVL 47" badge, no
  cosmetics. A level number plus a rank title that is a description of a practice,
  not a fantasy class.

**Curve.** Cost to advance from level *L* to *L+1*: `100 + 60·(L−1)`.
Cumulative XP to reach level *L*: `100(L−1) + 30(L−1)(L−2)`.
Uncapped; there is no prestige and no reset (see §3.9).

The formula is authoritative; the table below is derived from it and must be
regenerated, never hand-edited, if the coefficients ever change.

| Level | Cumulative XP | Roughly |
|---|---|---|
| 2 | 100 | one good day |
| 5 | 760 | first week |
| 10 | 3,060 | ~1 month |
| 20 | 12,160 | ~3.5 months |
| 40 | 48,360 | ~13 months |

**Ranks** — 8 bands, five levels each, the last one open-ended:

| Levels | Rank | Descriptor shown in UI |
|---|---|---|
| 1–5 | **Observer** | You are watching your own behaviour. |
| 6–10 | **Deliberate** | Fewer decisions are being made for you. |
| 11–15 | **Measured** | You know what a good day costs. |
| 16–20 | **Consistent** | Good days have stopped being unusual. |
| 21–25 | **Disciplined** | The standard holds without negotiation. |
| 26–30 | **Tempered** | Restraint is no longer effortful. |
| 31–35 | **Composed** | The impulse arrives and nothing follows it. |
| 36+ | **Self-Governed** | You set the terms. |

### 2.4 Streaks

- **Why.** Consecutive-day counts are the strongest known consistency mechanic,
  and Stoic's schedule semantics already handle the hard part (off-schedule days
  don't count against you).
- **Behaviour reinforced.** Not breaking a chain — but see the anxiety mitigation
  below, which is the difference between this and Duolingo's version.
- **Data.** Requires the ledger; the existing `limitStreakDays` is capped at 7 by
  the history window and is superseded.
- **Complexity.** Low.
- **Fits Stoic?** Only with the modifications below.

Two streaks, both defined on days the ledger has recorded:

1. **Discipline streak** — consecutive days held (the flagship).
2. **Per-rule streak** — consecutive scheduled days a single rule was respected.
   Replaces `limitStreakDays` with an unbounded, ledger-backed version and slots
   into the existing "Rule Adherence Streaks" card with no UI change.

**Anxiety mitigations (these are the design, not decoration):**
- **Current and best are always shown together, with equal weight.** Breaking a
  50-day streak does not erase 50 days; it ends a run, and the run is preserved
  as your record. This is the GitHub framing, not the Duolingo framing.
- **Absent days pause the streak, they never break it** (T6). A day with zero
  tracked time and zero gate events is neither held nor broken.
- **No streak freezes, no repair, no grace tokens.** See §3.3.
- **No notification ever references a streak** (T3).

### 2.5 Refusals

The single most Stoic metric available, and it does not exist yet.

A **refusal** is: the friction gate or block page was shown for a domain, and the
user did not push through. Computed at settlement as
`gatesShown − gatesPassed` per domain, capped at **3 per domain per day**.

- **Why.** It is the only metric that measures the *moment of choice* rather than
  its aggregate consequences. It also converts an unpleasant experience (being
  blocked) into evidence of who the user is becoming — the identity lever, which
  is the strongest behaviour-change mechanism available and costs nothing.
- **Behaviour reinforced.** Turning back. Precisely the target behaviour.
- **Data.** `navigateAfterTrip()` and the `GRANT_RESTRAINT_PASS` handler already
  fire at exactly the right moments; both currently discard the signal.
- **Complexity.** Very low — two `recordEvent` calls in `background.js`.
- **Fits Stoic?** It is the most aligned mechanic in this document.

**Farming vector, acknowledged:** a user could navigate to a restrained site
repeatedly to accumulate refusals. Mitigated by the per-domain daily cap of 3,
the daily XP cap of 30, and the fact that reaching the gate at all costs real
friction. Not eliminated; a personal tool need not be adversarial.

**Trade-off, acknowledged:** because refusals are computed by reconciliation at
settlement, XP for them arrives the next day rather than instantly. Immediate
reinforcement is provided instead by the **block page itself** showing the live
count ("You have turned back from this site 14 times"), which is stronger than a
number going up and requires no new messaging from `blocked.js`.

### 2.6 Achievements (including milestones)

- **Why.** Achievements name patterns the user cannot see in raw numbers ("four
  consecutive weeks of falling leisure time"), and give the system texture beyond
  a single ascending scalar.
- **Behaviour reinforced.** Varies per achievement — that is the point; XP alone
  can only reinforce one shape of behaviour.
- **Data.** All ledger-derived. Every achievement in the catalogue is evaluable
  from `days[]`, `weeks[]`, `months[]`, `streaks` and `lifetime`.
- **Complexity.** Moderate, but bounded: one array of definitions with a predicate
  each. Adding one later is a single array entry.
- **Fits Stoic?** With the hard rules below.

**Hard rules for the catalogue:**
- Earned by behaviour over time, never by configuration or navigation.
- One-shot and irrevocable (T2).
- Retroactively evaluable from the ledger — so a rule added later can still fire.
- No hidden or secret achievements (they induce hunting behaviour, which is
  engagement farming — §3.6).
- Achievement XP is recognition, not the economy: it should stay near ~15% of a
  year's total XP.

**Milestones are not a separate system.** A milestone is an achievement whose
predicate reads a lifetime counter crossing a round number. Merging them avoids a
duplicate subsystem with duplicate storage and duplicate rendering. They carry
`kind: "milestone"` and render in the same grid under a different heading.

Full catalogue: §5.

### 2.7 Personal records

- **Why.** Records are the honest form of competition: you against your own best
  day. They also make a broken streak survivable — the run becomes a record.
- **Behaviour reinforced.** Occasional reach for a genuinely excellent day,
  without the treadmill of needing to sustain it.
- **Data.** Ledger-derived; each record is one comparator over day/week rollups.
- **Complexity.** Very low.
- **Fits Stoic?** Yes — "compete with yourself" is the position the product
  already takes.

**Degenerate-day guard (required):** score- and ratio-based records must have a
minimum tracked-time qualifier, or a three-minute day sets an unbeatable focus
record on day one. Qualifiers are specified per record in §6.

### 2.8 Lifetime statistics

- **Why.** This is the retention surface. After a year, the ledger is the reason
  a user does not uninstall — and it is the one thing that cannot be rebuilt if
  it was never recorded (audit §6.2).
- **Behaviour reinforced.** None directly; it is the payoff for everything else.
- **Data.** Must be accumulated forward starting the day this ships. Nothing is
  back-derivable beyond the 6 days currently in `history`.
- **Complexity.** Low, but must be correct from day one — a counter that is wrong
  for six months cannot be repaired.
- **Fits Stoic?** Yes.

### 2.9 Weekly Standard

- **Why.** A week is the horizon at which people actually evaluate themselves, and
  it forgives a single bad day in a way a daily-only system cannot.
- **Behaviour reinforced.** Recovering within the week instead of writing it off
  after one slip.
- **Data.** Ledger-derived, no new inputs.
- **Complexity.** Trivial — one threshold check at week close.
- **Fits Stoic?** Yes, because it is a ceiling-type standard, not a volume target.

Weeks run **Monday–Sunday**. At week close, count days held among days the ledger
recorded (absent days excluded from both numerator and denominator):

| Days held | Bonus |
|---|---|
| 5 | 75 XP |
| 6 | 110 XP |
| 7 | 150 XP |

Tiers replace each other; they do not stack.

### 2.10 The contribution grid

- **Why.** One glance communicates months of behaviour better than any number,
  and it is the single highest perceived-value element per line of code in this
  design. GitHub proved the form; it reads as a record, not a game.
- **Behaviour reinforced.** Consistency — the visible cost of a gap is the gap
  itself, not a punishment.
- **Data.** Purely a render of `days[]`. No new state.
- **Complexity.** Low — an SVG/CSS grid of ~370 cells.
- **Fits Stoic?** Yes. It is a ledger, which is exactly the register this product
  should be in.

Cell states: **held** (green, `--sem-green`), **partial** (1–2 conditions met,
amber), **missed** (0 conditions, muted red), **absent** (no data — neutral,
explicitly *not* rendered as a failure, per T6).

### 2.11 The level-up moment

- **Why.** Progress with no acknowledgement is invisible; but interruption is the
  behaviour Stoic exists to oppose.
- **How.** A quiet, dismissible inline banner in the popup and at the top of the
  Progress tab, shown once. No modal, no animation beyond a fade, no sound, no
  notification. Dismissal is persisted (`lastLevelUp.seen`).

---

## 3. Rejected mechanics

Each of these is standard in the category and each is wrong here.

**3.1 XP for time spent in productive categories.** Violates T1 outright. It pays
users to sit on sites tagged Productivity and creates a direct incentive to
mis-classify leisure sites as productive — which would corrupt the analytics the
whole product rests on. *Rejected.*

**3.2 A global "days you used Stoic" streak.** Rewards opening the extension.
That is engagement farming, and under T6 an absent day is a good day. *Rejected.*

**3.3 Streak freezes / repair / grace days.** Duolingo's freeze exists to protect
a monetisable engagement metric; it works by making the streak feel too expensive
to lose. That is manufactured anxiety (T3) and it rewrites history dishonestly.
The chosen alternative — showing *best* alongside *current*, and preserving
broken runs as records — achieves the actual goal (a break should not feel like
total loss) without lying about what happened. *Rejected.*

**3.4 Negative XP, level decay, or XP loss for violations.** Violates T2. Also
breaks level and achievement monotonicity, which would force every consumer of
those values to handle regression. The absence of an award is sufficient signal.
*Rejected.*

**3.5 Daily rotating quests / challenges.** Requires the user to check in daily to
see what today's task is — a pure engagement mechanic (T3), and prospective
rather than retrospective (T5). *Rejected.*

**3.6 Hidden or secret achievements.** Induces hunting and speculation about the
system rather than attention to behaviour. Also unfalsifiable to the user, which
violates T4. *Rejected.*

**3.7 Leaderboards, friends, sharing, comparison.** No server exists, and adding
one would break the product's core promise that nothing leaves the device.
Comparison against others is also the opposite of the position the product takes.
*Rejected — permanently, not deferred.*

**3.8 Cosmetics, avatars, badges to equip, themes as rewards.** Childish register,
and they create a reason to engage with the extension for its own sake. The only
"reward" in this system is an accurate record. *Rejected.*

**3.9 Prestige / seasons / periodic resets.** A treadmill that discards the one
asset the user has accumulated. Directly opposed to §2.8 being the retention
surface. The level curve is uncapped instead. *Rejected.*

**3.10 XP for configuration work** (adding rules, classifying channels, tuning AI
settings). Pays for busywork inside the extension. The two `origin` achievements
in §5 are the deliberate, bounded exception — they exist to give a brand-new user
a first signal on day one, are worth 25 XP each, and cannot be repeated.
*Rejected as a general principle.*

**3.11 A separate "goals" subsystem with user-defined targets.** Every additional
configurable goal multiplies the surface area (UI, validation, migration,
achievement predicates) while the Daily Standard already covers the meaningful
cases. Two tuning knobs — leisure ceiling and focus target — are exposed instead.
*Rejected in favour of §2.2.*

**3.12 XP for completing the friction gate.** It rewards the failure path.
Recorded as a statistic (`gatesPassed`), never rewarded. *Rejected.*

**3.13 Penalising rule loosening.** Deleting a restraint already costs a full
friction gate. Recorded honestly in lifetime stats as `rulesLoosened` and shown
without commentary; no XP consequence, because punishing the user for changing
their own configuration is paternalistic and would push them toward disabling the
extension entirely. *Recorded, not penalised.*

**3.14 Retroactive XP recalculation after re-classification.** Re-classifying a
channel corrects *today's* analytics (the existing read-time resolution already
does this) but must not rewrite settled days. Immutable history is worth more
than perfect retroactivity: without it, a user's level could drop, violating T2,
and the ledger would stop being a record of what was actually judged.
*Rejected — settled days are frozen by design.*

---

## 4. The XP economy

All values are constants in `progression-model.js` (§2 of the architecture doc).

### Day XP — settled once, the day after
| Component | XP | Condition |
|---|---|---|
| Adherence (C1) | 25 | no rule violated |
| Restraint (C2) | 25 | leisure ≤ ceiling |
| Focus (C3) | 25 | focus ≥ target, or waived under 30 min tracked |
| Day-held bonus | 25 | all three met |
| Streak bonus | 2 × current streak, **capped at 50** | day held |
| Refusals | 10 each, **max 3/domain, max 30/day** | gate shown and not passed |

Perfect day ceiling: **180 XP**. Realistic strong day: 100–130.
An **absent day** (no tracked time, no gate events) earns 0 and changes nothing.

### Weekly XP
5/6/7 days held → 75 / 110 / 150 (§2.9).

### Achievement XP
Five fixed tiers: **25 / 50 / 100 / 200 / 400**.

### Calibration check
A consistent user holding ~6 days a week earns roughly
`6×120 + 110 ≈ 830 XP/week` before achievements — reaching Level 10 in about
four weeks and Level 20 in about three and a half months. A user who holds two days a week
earns ~300/week and progresses about a third as fast. The ratio is deliberate:
consistency should dominate, but a struggling user must still visibly move, or
the system becomes another thing they have failed at.

---

## 5. Achievement catalogue

27 achievements. `kind` is `origin` | `streak` | `refusal` | `restraint` |
`focus` | `rule` | `milestone` | `improvement` | `recovery`.

| id | Name | Kind | XP | Earned when |
|---|---|---|---|---|
| `first_rule` | First Line Drawn | origin | 25 | First moderation rule created |
| `first_week` | Seven Days Observed | origin | 25 | 7 days recorded in the ledger |
| `clean_week` | Clean Week | streak | 50 | Discipline streak reaches 7 |
| `clean_fortnight` | Clean Fortnight | streak | 100 | …reaches 14 |
| `clean_month` | Clean Month | streak | 200 | …reaches 30 |
| `clean_quarter` | Clean Quarter | streak | 400 | …reaches 90 |
| `clean_year` | Clean Year | streak | 400 | …reaches 365 |
| `first_refusal` | Turned Back | refusal | 25 | First refusal recorded |
| `refusals_10` | Ten Refusals | refusal | 50 | Lifetime refusals ≥ 10 |
| `refusals_50` | Fifty Refusals | refusal | 100 | ≥ 50 |
| `refusals_250` | Two Hundred and Fifty | refusal | 200 | ≥ 250 |
| `silent_day` | Silent Day | restraint | 50 | A tracked day with zero leisure seconds |
| `quiet_week` | Quiet Week | restraint | 100 | 7 consecutive days with leisure ≤ 30 min |
| `silent_week` | Silent Week | restraint | 400 | 7 consecutive days with zero leisure |
| `deep_day` | Deep Day | focus | 50 | Focus ≥ 90 on a day with ≥ 2h tracked |
| `deep_week` | Deep Week | focus | 100 | Trailing 7-day mean focus ≥ 80 over ≥ 5 tracked days |
| `unbroken_30` | Unbroken | rule | 100 | One rule held 30 consecutive scheduled days |
| `ironclad_100` | Ironclad | rule | 200 | …100 consecutive scheduled days |
| `days_30` | Thirty Days | milestone | 50 | 30 days tracked |
| `days_100` | One Hundred Days | milestone | 100 | 100 days tracked |
| `days_365` | One Year | milestone | 200 | 365 days tracked |
| `days_1000` | One Thousand Days | milestone | 400 | 1000 days tracked |
| `productive_100h` | One Hundred Hours | milestone | 50 | 100h lifetime productive time |
| `productive_500h` | Five Hundred Hours | milestone | 100 | 500h |
| `productive_1000h` | One Thousand Hours | milestone | 200 | 1000h |
| `downward_trend` | Downward Trend | improvement | 200 | 4 consecutive weeks each with less leisure time than the week before |
| `back_on` | Back On | recovery | 100 | Reach a 7-day streak after previously ending a streak of ≥ 14 |

`downward_trend` and `back_on` exist because without them a heavy user or a user
who has just broken a long streak can earn nothing for weeks. Rewarding
*improvement* and *recovery*, not only absolute performance, is what keeps the
system from being demoralising to exactly the users who need it most.

---

## 6. Personal records

| id | Label | Direction | Qualifier |
|---|---|---|---|
| `longest_streak` | Longest discipline streak | max | — |
| `best_focus_day` | Best focus score | max | ≥ 60 min tracked |
| `most_productive_day` | Most productive time in a day | max | — |
| `lowest_leisure_day` | Least leisure on an active day | **min** | ≥ 60 min tracked |
| `most_refusals_day` | Most refusals in a day | max | — |
| `longest_rule_run` | Longest single-rule run | max | stores the domain |
| `best_week_focus` | Best weekly focus average | max | ≥ 4 tracked days |
| `most_held_month` | Most days held in a month | max | — |

Every record stores `{ value, date, meta }`. Records are set at settlement only
and, like everything else, are never lost.

---

## 7. Where it appears

**Popup — a compact strip beneath the existing hero.** Level number, rank name,
XP progress bar to next level, three condition dots for today (live, not
settled), current streak. One row. It must not displace the focus gauge or the
top-sites list.

**Options — a new "Progress" tab**, placed second, between Overview and Detailed
Analysis. Sections in order:
1. Identity header — level ring, rank + descriptor, XP bar, "N XP to Level M".
2. Today's standing — the three conditions with live values and their thresholds.
3. Streaks — current and best, side by side, plus per-rule runs.
4. Contribution grid — 365 days.
5. Personal records.
6. Achievements — earned first, then locked with their criteria visible (T4).
7. Lifetime statistics.

**Blocked page (restraint reason only)** — one line in the existing stat row:
"Turned back from this site: N times". Nothing else. The block page must not
become a progress dashboard; its job is to be unpleasant enough to work.

**Preferences tab** — two new fields: leisure ceiling (minutes) and focus target,
with plain-language explanations of what each changes.

**Nowhere else.** In particular: no badge on the toolbar icon, no notification,
no injected content on any page.
</content>
</invoke>
