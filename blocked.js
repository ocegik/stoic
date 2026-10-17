const params = new URLSearchParams(window.location.search);
const site = params.get("site") || "this site";
const reason = params.get("reason") || "blocked";
const tabIdParam = params.get("tabId");
const tabId = tabIdParam ? Number(tabIdParam) : null;

// Stoic-inspired reflections, paraphrased in plain language rather than
// quoted from any historical text. Each one leans on a different Stoic
// idea (what's in your control, the present moment, habituation, virtue
// over pleasure) but none of them are verbatim lines from anyone.
const QUOTES = [
  "What is and isn't yours to control is worth sorting out early. This tab was never in the first category.",
  "Discipline is just clarity, held a little past the point where it stops feeling urgent.",
  "The obstacle in front of you is also the material you're meant to work with.",
  "A mind that keeps its own schedule doesn't need a platform to fill it.",
  "Attention spent here is attention you don't get to spend twice.",
  "Restraint isn't the absence of wanting. It's deciding what the wanting is actually worth.",
  "You don't arrive at a calmer day by waiting for one. You build it, one closed tab at a time.",
  "The impulse will pass on its own in a minute or two. Acting on it just teaches it to come back sooner.",
  "What you repeatedly choose is quietly becoming who you are.",
  "Freedom isn't doing whatever occurs to you. It's not being ruled by whatever occurs to you.",
  "Today is the only day you actually have. Most of what's on the other side of this block is built to make you forget that.",
  "A disciplined hour outweighs an entertained one. The feed is counting on you forgetting that.",
  "Nothing waiting on the other side of this page needs you as urgently as it wants you to believe.",
  "Closing this isn't deprivation. It's choosing what actually deserves the next few minutes.",
];

function equivalencyFor(weeklyMinutes) {
  if (weeklyMinutes < 15) {
    return "Small so far this week — but this is exactly how the bigger numbers start.";
  } else if (weeklyMinutes < 45) {
    return `${fmtMinutes(weeklyMinutes)} this week is about the length of a workout you didn't do.`;
  } else if (weeklyMinutes < 90) {
    return `${fmtMinutes(weeklyMinutes)} this week is roughly a full episode of something you actually chose to watch, spent scrolling instead.`;
  } else if (weeklyMinutes < 180) {
    return `${fmtMinutes(weeklyMinutes)} this week is close to a whole movie's runtime — handed to a feed instead of something you'll remember.`;
  } else if (weeklyMinutes < 360) {
    return `${fmtMinutes(weeklyMinutes)} this week is several real hours. That's a free afternoon, gone in small pieces.`;
  } else {
    return `${fmtMinutes(weeklyMinutes)} this week is close to a full workday. On one site.`;
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function fmtUntil(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// When will this site open again, in words? Only says something that is
// actually true for this rule: an always-closed site with no schedule never
// "resets", so it gets no line at all.
function reopenText(entry, reason) {
  if (reason === "restraint") return "";
  const now = new Date();
  const schedule = normalizeSchedule(entry.schedule);
  const end = timeStringToMinutes(schedule.endTime);
  if (end !== null && isWithinTimeWindow(entry, now)) {
    const at = new Date(now);
    at.setHours(Math.floor(end / 60), end % 60, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    return `Opens again at ${schedule.endTime} · in ${fmtUntil(at - now)}`;
  }
  if (reason === "limit") {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return `A new day's minutes start at midnight · in ${fmtUntil(midnight - now)}`;
  }
  for (let i = 1; i <= 7; i++) {
    const day = addDays(now, i);
    if (!isScheduleDay(entry, day)) return `Opens again on ${day.toLocaleDateString([], { weekday: "long" })}`;
  }
  return "";
}

function renderFacts(facts) {
  document.getElementById("statRow").innerHTML = facts
    .map((f) => `<div class="bp-fact${f.good ? " is-good" : ""}"><dd>${f.value}</dd><dt>${f.label}</dt></div>`)
    .join("");
}

// Picks a random quote, excluding whichever index was shown last time, so
// the same reflection never appears twice in a row. Uses an "index shift"
// rather than reject-and-retry so the remaining quotes stay uniformly
// likely regardless of how many there are.
function pickIndexExcluding(length, excludeIndex) {
  if (length <= 1) return 0;
  let index = Math.floor(Math.random() * (length - 1));
  if (typeof excludeIndex === "number" && index >= excludeIndex) {
    index += 1;
  }
  return index;
}

async function pickQuote() {
  const { lastQuoteIndex } = await chrome.storage.local.get("lastQuoteIndex");
  const index = pickIndexExcluding(QUOTES.length, lastQuoteIndex);
  await chrome.storage.local.set({ lastQuoteIndex: index });
  return QUOTES[index];
}

// "Turned back from this site: N times" — the block page's own live
// reinforcement for a refusal, since the XP for it only lands at next
// settlement (01-PRODUCT-DESIGN.md §2.5). DayRecord has no per-domain gate
// data, so this reads the honest sources that do: the settled lifetime
// counter plus whatever today's live gate counters (not yet settled) add
// for this domain, capped the same way settlement itself caps a domain's
// daily refusals.
async function turnedBackCountFor(domain) {
  const prog = await loadProgression();
  const settled = (prog.lifetime.refusalsByDomain && prog.lifetime.refusalsByDomain[domain]) || 0;

  let liveToday = 0;
  if (prog.today && prog.today.date === todayStr()) {
    const shown = (prog.today.gatesShown && prog.today.gatesShown[domain]) || 0;
    const passed = (prog.today.gatesPassed && prog.today.gatesPassed[domain]) || 0;
    liveToday = Math.min(Math.max(shown - passed, 0), REFUSAL_MAX_PER_DOMAIN_PER_DAY);
  }

  return settled + liveToday;
}

async function main() {
  applyTheme(await getThemePreference());

  const sites = await getSites();
  const entry = sites[site] || {};
  const displayName = getDomainDisplayName(site);

  const headline = document.getElementById("headline");
  const subhead = document.getElementById("subhead");
  const eyebrow = document.getElementById("eyebrowStatus");
  const context = document.getElementById("equivalency");

  document.getElementById("placardText").textContent = await pickQuote();

  const today = todayStr();
  const todaySeconds = usageSecondsForDate(entry, today, today);
  const weekSeconds = trailingWeekUsage(entry).reduce((sum, d) => sum + d.seconds, 0);
  const tripsToday = tripsForDate(entry, today, today);
  const activeRule = getActiveRule(entry);
  const limitMinutes = activeRule.limitMinutes || entry.limitMinutes || 0;
  const siteHtml = `<span class="site">${escapeHtml(displayName)}</span>`;
  const stoppedToday = { value: tripsToday, label: tripsToday === 1 ? "Time stopped here today" : "Times stopped here today" };

  if (reason === "limit") {
    eyebrow.textContent = "Daily limit reached";
    eyebrow.className = "bp-eyebrow is-partial";
    headline.textContent = "Today's limit is spent";
    subhead.innerHTML = `You gave ${siteHtml} ${limitMinutes} minutes a day. That was all of them.`;
    renderFacts([
      { value: fmtDuration(todaySeconds), label: "Today" },
      { value: fmtDuration(weekSeconds), label: "Last 7 days" },
      stoppedToday,
    ]);
    context.textContent = equivalencyFor(weekSeconds / 60);
  } else if (reason === "restraint") {
    const targetUrl = params.get("targetUrl") || `https://${site}`;
    eyebrow.textContent = "Pause before opening";
    eyebrow.className = "bp-eyebrow is-waived";
    headline.textContent = "You asked to be stopped here.";
    subhead.innerHTML = `A minute from now, ${siteHtml} will feel less urgent than it does right now. If it still matters then, the way through is below.`;
    const turnedBack = await turnedBackCountFor(site);
    renderFacts([
      { value: turnedBack, label: "Turned back from here", good: turnedBack > 0 },
      { value: fmtDuration(todaySeconds), label: "Spent here today" },
      stoppedToday,
    ]);
    setupRestraintChallenge(site, targetUrl);
  } else {
    eyebrow.textContent = "Always closed";
    eyebrow.className = "bp-eyebrow is-missed";
    headline.textContent = "This one stays closed";
    subhead.innerHTML = `You set ${siteHtml} to stay closed. There is no way through from here.`;
    renderFacts([
      stoppedToday,
      { value: entry.timesTripped || 0, label: "Times reached for, all time" },
    ]);
    context.textContent = tripsToday > 3
      ? "Reaching for it is a habit. Not opening it is how the habit thins out."
      : "";
  }

  const renderReopen = () => { document.getElementById("resetNote").textContent = reopenText(entry, reason); };
  renderReopen();
  setInterval(renderReopen, 30000);
}

// The pause: a mandatory 60s wait, two hard problems back to back, and a
// genuinely written reason — all running concurrently, all required before
// Continue unlocks. The only choice offered is how long the site stays open
// afterwards, and the shortest is the default.
const PASS_OPTIONS = [5, 15, 30];

function setupRestraintChallenge(site, destUrl) {
  const box = document.getElementById("restraintBox");
  const steps = document.getElementById("restraintWidget");
  const continueBtn = document.getElementById("continueBtn");
  const gateCount = document.getElementById("gateCount");
  const passSeg = document.getElementById("passSeg");
  const displayName = getDomainDisplayName(site);
  const question = REFLECTION_QUESTIONS[Math.floor(Math.random() * REFLECTION_QUESTIONS.length)];
  let passMinutes = PASS_OPTIONS[0];

  box.hidden = false;
  continueBtn.hidden = false;

  steps.innerHTML = `
    <li class="bp-step" id="stepWait">
      <span class="bp-step-mark">1</span>
      <div>
        <p class="bp-step-title">Wait sixty seconds</p>
        <div class="bp-wait">
          <div class="bp-wait-track"><div class="bp-wait-fill" id="waitFill"></div></div>
          <span class="bp-wait-val" id="waitVal">${RESTRAINT_WAIT_SECONDS}s</span>
        </div>
      </div>
    </li>
    <li class="bp-step" id="stepPuzzle">
      <span class="bp-step-mark">2</span>
      <div>
        <p class="bp-step-title">Solve ${RESTRAINT_PUZZLE_STREAK_REQUIRED} in a row</p>
        <div class="bp-puzzle">
          <span class="bp-puzzle-q" id="puzzleQuestion"></span>
          <input type="number" class="field" id="puzzleInput" placeholder="Answer" aria-label="Answer" />
          <button type="button" class="btn-ghost" id="puzzleSubmitBtn">Check</button>
          <span class="bp-puzzle-dots" id="puzzleProgress"></span>
        </div>
        <div class="field-error" id="puzzleErr" hidden>Not quite. The streak starts again with a new problem.</div>
      </div>
    </li>
    <li class="bp-step" id="stepReason">
      <span class="bp-step-mark">3</span>
      <div class="bp-reason">
        <p class="bp-step-title">Say why, in your own words</p>
        <p class="bp-reason-q">${question}</p>
        <textarea class="field" id="reasonInput" rows="3" placeholder="At least ${RESTRAINT_MIN_REASON_WORDS} words"></textarea>
        <div class="field-error" id="reasonErr" hidden></div>
      </div>
    </li>`;

  passSeg.innerHTML = PASS_OPTIONS.map((m, i) => (
    `<button type="button" class="seg-btn${i === 0 ? " active" : ""}" role="radio" aria-checked="${i === 0}" data-value="${m}">${m} min</button>`
  )).join("");
  passSeg.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      passMinutes = Number(btn.dataset.value);
      passSeg.querySelectorAll(".seg-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-checked", b === btn ? "true" : "false");
      });
      refresh();
    });
  });

  const state = { wait: false, puzzle: false, reason: false };
  const stepEls = { wait: "stepWait", puzzle: "stepPuzzle", reason: "stepReason" };

  function refresh() {
    let left = 0;
    for (const key of Object.keys(state)) {
      document.getElementById(stepEls[key]).classList.toggle("is-done", state[key]);
      const mark = document.querySelector(`#${stepEls[key]} .bp-step-mark`);
      mark.textContent = state[key] ? "✓" : String(Object.keys(state).indexOf(key) + 1);
      if (!state[key]) left++;
    }
    gateCount.textContent = left ? `${left} step${left === 1 ? "" : "s"} left` : "Done";
    gateCount.classList.toggle("is-done", !left);
    continueBtn.disabled = left > 0;
    continueBtn.textContent = left ? "Complete the steps above" : `Open ${displayName} for ${passMinutes} min`;
  }
  refresh();

  // --- 1: wait ---
  let rem = RESTRAINT_WAIT_SECONDS;
  const waitFill = document.getElementById("waitFill");
  const waitVal = document.getElementById("waitVal");
  const timer = setInterval(() => {
    rem--;
    waitVal.textContent = `${Math.max(rem, 0)}s`;
    waitFill.style.width = `${((RESTRAINT_WAIT_SECONDS - rem) / RESTRAINT_WAIT_SECONDS) * 100}%`;
    if (rem <= 0) {
      clearInterval(timer);
      state.wait = true;
      refresh();
    }
  }, 1000);

  // --- 2: problems ---
  const input = document.getElementById("puzzleInput");
  const err = document.getElementById("puzzleErr");
  const checkBtn = document.getElementById("puzzleSubmitBtn");
  let puzzle = generateHardPuzzle();
  let streak = 0;

  function renderPuzzle() {
    document.getElementById("puzzleQuestion").textContent = puzzle.question;
    document.getElementById("puzzleProgress").innerHTML = Array.from({ length: RESTRAINT_PUZZLE_STREAK_REQUIRED })
      .map((_, i) => `<span class="gate-dot ${i < streak ? "gate-dot-filled" : ""}"></span>`)
      .join("");
  }
  renderPuzzle();

  function checkPuzzle() {
    if (input.value.trim() === "") return;
    const correct = Number(input.value) === puzzle.answer;
    streak = correct ? streak + 1 : 0;
    err.hidden = correct;
    if (streak >= RESTRAINT_PUZZLE_STREAK_REQUIRED) {
      state.puzzle = true;
      input.disabled = true;
      checkBtn.disabled = true;
      renderPuzzle();
      refresh();
      return;
    }
    puzzle = generateHardPuzzle();
    input.value = "";
    input.focus();
    renderPuzzle();
  }
  checkBtn.addEventListener("click", checkPuzzle);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      checkPuzzle();
    }
  });

  // --- 3: reason ---
  const reasonInput = document.getElementById("reasonInput");
  const reasonErr = document.getElementById("reasonErr");
  reasonInput.addEventListener("input", () => {
    const result = validateOpenReason(reasonInput.value);
    state.reason = result.valid;
    reasonErr.hidden = result.valid;
    reasonErr.textContent = result.message;
    refresh();
  });

  continueBtn.addEventListener("click", async () => {
    if (continueBtn.disabled) return;
    continueBtn.disabled = true;
    continueBtn.textContent = "Opening…";

    let currentTabId = tabId;
    if (!currentTabId) {
      try {
        const t = await chrome.tabs.getCurrent();
        if (t?.id) currentTabId = t.id;
      } catch {
        /* ignore */
      }
    }

    try {
      await grantRestraintPass(site, passMinutes, currentTabId);
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "GRANT_RESTRAINT_PASS", domain: site, durationMinutes: passMinutes, tabId: currentTabId },
          () => {
            if (chrome.runtime.lastError) {
              /* worker asleep — the pass written above still holds */
            }
            resolve();
          }
        );
      });
    } catch (e) {
      console.error("[Stoic] Error granting pass:", e);
    }

    window.location.href = destUrl || `https://${site}`;
  });
}

// Turning back must never land on the site that was just stopped:
// history.back() returned to it, the rule tripped again, and the user was
// stuck bouncing between the two (and the trip counter ran into hundreds).
document.getElementById("closeBtn").addEventListener("click", async () => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: "chrome://newtab" });
      return;
    }
  } catch {
    /* fall through */
  }
  window.close();
});

main();
