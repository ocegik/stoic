# Stoic — Glossary & Copy Brief

Date adopted: 2026-07-30
Status: **binding**. Every user-facing string in the extension follows this
document. If a string here and a string in the code disagree, the code is wrong.

This exists because the product audit found three names for the same concept and
four distinct voices across the surfaces (`docs/audit/PRODUCT-AUDIT.md` §1.4).
Neither is a typo problem. Both are the result of never having written this file.

---

## 1. The four things a user should feel

Named, because until they are named the copy drifts.

1. **Composure, not motivation.** The user should feel steadier after using
   Stoic, not fired up.
2. **Being seen accurately, not judged.** The product holds up an honest mirror.
   *"You spent 4h 12m here this week"* is the tone. *"You wasted 4h 12m"* is not.
3. **Friction as respect, not punishment.** The pause is hard because the user's
   past self asked for it to be. Attribute every constraint to the user, never
   to the extension.
4. **A record worth keeping.** A training log, not a game.

The one feeling to design *out*: **anxiety about the number.** Every competitor's
retention depends on it. Stoic's thesis forbids it.

---

## 2. One word per concept

| Concept | The word | Never |
|---|---|---|
| A constraint the user created | **rule** | discipline, moderation rule, site limiter, restriction |
| A daily time cap on a site | **daily limit** | moderation, allowance, cap, quota |
| Friction shown before a site opens | **the pause** | restraint mode, mindful restraint, interstitial, cooling-off |
| Turning a rule off for a fixed stretch (15 min, 1 hour, rest of today) | **suspend** / **resume** | pause (reserved for the gate), disable, snooze |
| A site set never to open | **always closed** | full block, block mode, restraint |
| The 60s + two problems + one sentence challenge | **the pause** (user-facing) / *friction gate* (code only) | challenge, puzzle gate, hurdle |
| Turning away instead of pushing through | **turned back**, a **refusal** | resisted, willpower, self-control |
| A day that met the standard | **held** | success, win, completed |
| A day that didn't | **missed** | failed, lost, broken |
| A day excused | **waived** | skipped, free pass |
| The long-term ledger | **your record** | progress, stats, analytics, dashboard |
| The options page as a whole | **Stoic** (the page has tabs, not a name) | dashboard, console, admin |
| The settings tab | **Settings** | Preferences, Storage & Synchronization |
| Time classification | **Productive / General / Leisure** | (unchanged — these are correct) |

### The three rule modes, as the user sees them

| Stored `mode` | Label | One-line description |
|---|---|---|
| `limit` | **Daily limit** | A set number of minutes a day. After that, the site stops opening. |
| `restraint` | **Pause first** | Sixty seconds, two problems and one written sentence before it opens. |
| `block` | **Always closed** | It doesn't open. |

The stored values do not change — this is a naming decision, not a data one.

---

## 3. Voice rules

**Do**

- State the fact. `DAILY LIMIT REACHED`, not `DISCIPLINE HELD`.
- Attribute constraints to the user: *"You asked to be stopped here."*
- Use plain numbers and plain nouns. Sentence case for everything except the
  small uppercase eyebrows.
- Say what a screen would show if it had data, when it has none.
- Reserve the serif for the two places the product speaks in its own voice: the
  reflection on the block page, and the rank descriptor on the record.

**Don't**

- No exclamation marks. Anywhere.
- No praise (`Great job!`, `Nice work`), no scolding (`You're about to throw away
  your focus again`), no streak-danger (`Don't lose your 12 days!`).
- No internal vocabulary in the UI: `yt_channels`, `domain_rule`, `MISS`,
  `Cache Status`, `manual_channel`. If a user can see it, it is written in
  English.
- No verdict language on a failure surface. "Held" is earned on the record, not
  offered as consolation on the block page.
- No estimate presented as a measurement. If a number is derived, say how.

---

## 4. The strings that carry the product

These ten are load-bearing. Change them deliberately, not casually.

| Where | String |
|---|---|
| Extension name | `Stoic` |
| Store description | *Sixty seconds before a site opens, and an honest record of where your attention actually went. Everything stays on your machine.* |
| Block page — limit | eyebrow `DAILY LIMIT REACHED` · headline *Today's limit is spent* |
| Block page — pause | eyebrow `PAUSE BEFORE OPENING` · headline *You asked to be stopped here.* |
| Block page — closed | eyebrow `ALWAYS CLOSED` · headline *This one stays closed* |
| The pause, subhead | *A minute from now this will feel less urgent. If it still matters then, the way through is below.* |
| Refusal metric | *Turned back from this site: N times* |
| Rule change warning | *Loosening a rule costs the same sixty seconds as breaking one.* |
| Popup, primary action | *Limit this site* |
| Permission rationale | *Stoic reads the address of the tab you're looking at, so it can time it. That never leaves this machine — there is no account and no server.* |

---

## 5. Applying this

When adding any user-facing string:

1. Find the concept in §2 and use that word.
2. Read it against §1. If it congratulates, scolds, or creates urgency, rewrite it.
3. If it names something the user didn't create, it's internal — don't show it.
