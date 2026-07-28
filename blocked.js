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

function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
}

function renderResetNote() {
  const ms = msUntilMidnight();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  document.getElementById("resetNote").textContent = `Resets in ${h}h ${m}m`;
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

async function main() {
  const themePref = await getThemePreference();
  applyTheme(themePref);

  const sites = await getSites();
  const entry = sites[site] || {};

  const headline = document.getElementById("headline");
  const subhead = document.getElementById("subhead");
  const eyebrowStatus = document.getElementById("eyebrowStatus");
  const statRow = document.getElementById("statRow");
  const placardText = document.getElementById("placardText");
  const equivalency = document.getElementById("equivalency");

  placardText.textContent = await pickQuote();

  const today = todayStr();
  const todaySeconds = entry.lastReset === today ? entry.usedSeconds || 0 : 0;
  const todayMinutes = todaySeconds / 60;
  const activeRule = getActiveRule(entry);
  const limitMinutes = activeRule.limitMinutes || entry.limitMinutes || "?";

  const weeklySeconds =
    todaySeconds + (entry.history || []).reduce((sum, h) => sum + (h.seconds || 0), 0);
  const weeklyMinutes = weeklySeconds / 60;
  const timesTripped = entry.timesTripped || 0;

  if (reason === "limit") {
    eyebrowStatus.textContent = "DISCIPLINE HELD · MODERATION";
    headline.textContent = "Time's up for today";
    subhead.innerHTML = `You've used today's ${limitMinutes} minute limit on <span class="site">${site}</span>.`;
    statRow.innerHTML = `
      <div class="stat-cell"><div class="stat-value">${fmtMinutes(todayMinutes)}</div><div class="stat-label">Today</div></div>
      <div class="stat-cell"><div class="stat-value">${fmtMinutes(weeklyMinutes)}</div><div class="stat-label">This week</div></div>
      <div class="stat-cell"><div class="stat-value">${timesTripped}</div><div class="stat-label">Times tested</div></div>
    `;
    equivalency.textContent = equivalencyFor(weeklyMinutes);
  } else if (reason === "restraint") {
    const targetUrl = params.get("targetUrl") || `https://${site}`;
    const displayName = getDomainDisplayName(site);

    eyebrowStatus.textContent = "MINDFUL PAUSE · RESTRAINT MODE";
    headline.textContent = "You're about to throw away your focus again.";
    subhead.innerHTML = `You installed Stoic because you knew a moment like this — reaching for <span class="site">${displayName}</span> — would come. Is this genuinely important, or just another dopamine hit? Every distraction here delays the work that actually moves your life forward.`;
    statRow.innerHTML = `
      <div class="stat-cell"><div class="stat-value">${timesTripped}</div><div class="stat-label">Times paused</div></div>
    `;
    equivalency.textContent = "Restraint Mode isn't here to be convenient. It's here to make you decide on purpose, not on impulse.";

    setupRestraintChallenge(site, targetUrl);
  } else {
    eyebrowStatus.textContent = "DISCIPLINE HELD · RESTRAINT";
    headline.textContent = "This one stays closed";
    subhead.innerHTML = `<span class="site">${site}</span> is under full restraint.`;
    statRow.innerHTML = `
      <div class="stat-cell"><div class="stat-value">${timesTripped}</div><div class="stat-label">Times you've reached for it</div></div>
    `;
    equivalency.textContent =
      timesTripped > 5
        ? "That's a lot of reflexive taps toward something you already decided to cut off."
        : "Every time this doesn't open, the habit gets a little weaker.";
  }

  renderResetNote();
  setInterval(renderResetNote, 60000);
}

// Restraint Mode is now a single fixed-difficulty gate: a mandatory 60s
// wait, two hard puzzles solved back to back, and a genuinely written
// reason — all three running concurrently, all three required before
// Continue unlocks. There is no easier configuration to pick.
function setupRestraintChallenge(site, destUrl) {
  const restraintBox = document.getElementById("restraintBox");
  const restraintBadge = document.getElementById("restraintBadge");
  const restraintWidget = document.getElementById("restraintWidget");
  const continueBtn = document.getElementById("continueBtn");
  const closeBtn = document.getElementById("closeBtn");

  if (!restraintBox || !restraintWidget || !continueBtn) return;

  restraintBox.style.display = "flex";
  continueBtn.style.display = "inline-flex";
  continueBtn.disabled = true;
  continueBtn.textContent = "Complete the steps below";
  if (closeBtn) closeBtn.textContent = "Go back";
  if (restraintBadge) restraintBadge.textContent = "DELIBERATE FRICTION GATE";

  const displayName = getDomainDisplayName(site);
  const randomQ = REFLECTION_QUESTIONS[Math.floor(Math.random() * REFLECTION_QUESTIONS.length)];

  restraintWidget.innerHTML = `
    <div class="gate-step" id="gateTimerStep">
      <div class="gate-step-label">1 · Wait it out — cannot be skipped</div>
      <div class="countdown-timer-wrap">
        <svg viewBox="0 0 90 90" class="countdown-svg">
          <circle cx="45" cy="45" r="40" class="countdown-ring-bg" />
          <circle cx="45" cy="45" r="40" class="countdown-ring-fill" id="countdownRing" />
        </svg>
        <span class="countdown-number" id="countdownVal">${RESTRAINT_WAIT_SECONDS}</span>
      </div>
    </div>

    <div class="gate-step" id="gatePuzzleStep">
      <div class="gate-step-label">2 · Solve ${RESTRAINT_PUZZLE_STREAK_REQUIRED} in a row</div>
      <div class="math-puzzle-box">
        <div class="math-question" id="puzzleQuestion"></div>
        <input type="number" class="math-input" id="puzzleInput" placeholder="?" autofocus />
        <div class="gate-puzzle-progress" id="puzzleProgress"></div>
        <div class="field-error" id="puzzleErr" style="display:none;">Incorrect. Streak reset — new problem:</div>
        <button type="button" class="btn-ghost" id="puzzleSubmitBtn" style="padding: 8px 16px;">Check Answer</button>
      </div>
    </div>

    <div class="gate-step" id="gateReasonStep">
      <div class="gate-step-label">3 · Answer honestly, in your own words</div>
      <div class="reflection-box">
        <div class="reflection-q">"${randomQ}"</div>
        <textarea class="reflection-input" id="reasonInput" rows="3" placeholder="Write a real, specific reason (at least ${RESTRAINT_MIN_REASON_WORDS} words)..."></textarea>
        <div class="field-error" id="reasonErr" style="display:none;"></div>
      </div>
    </div>
  `;

  const state = { timerDone: false, puzzleDone: false, reasonDone: false };

  function maybeUnlock() {
    if (state.timerDone && state.puzzleDone && state.reasonDone) unlockChallenge();
  }

  function unlockChallenge() {
    continueBtn.disabled = false;
    continueBtn.textContent = `Continue to ${displayName}`;
    continueBtn.classList.remove("btn-ghost");
    continueBtn.classList.add("btn-accent");
  }

  // --- Step 1: mandatory, non-skippable wait ---
  let rem = RESTRAINT_WAIT_SECONDS;
  const circumference = 251.2;
  const ringFill = document.getElementById("countdownRing");
  const valEl = document.getElementById("countdownVal");

  const timerInterval = setInterval(() => {
    rem--;
    if (valEl) valEl.textContent = rem > 0 ? rem : "0";
    if (ringFill) {
      const offset = circumference * (1 - rem / RESTRAINT_WAIT_SECONDS);
      ringFill.style.strokeDashoffset = String(offset);
    }
    if (rem <= 0) {
      clearInterval(timerInterval);
      state.timerDone = true;
      maybeUnlock();
    }
  }, 1000);

  // --- Step 2: hard puzzle, streak required ---
  let currentPuzzle = generateHardPuzzle();
  let streak = 0;

  function renderPuzzleProgress() {
    const progress = document.getElementById("puzzleProgress");
    if (!progress) return;
    progress.innerHTML = Array.from({ length: RESTRAINT_PUZZLE_STREAK_REQUIRED })
      .map((_, i) => `<span class="gate-dot ${i < streak ? "gate-dot-filled" : ""}"></span>`)
      .join("");
  }

  function renderPuzzleQuestion() {
    const qEl = document.getElementById("puzzleQuestion");
    if (qEl) qEl.textContent = currentPuzzle.question;
    renderPuzzleProgress();
  }

  renderPuzzleQuestion();

  function checkPuzzle() {
    const input = document.getElementById("puzzleInput");
    const err = document.getElementById("puzzleErr");
    if (!input) return;
    const val = Number(input.value);
    if (input.value.trim() !== "" && val === currentPuzzle.answer) {
      streak++;
      if (err) err.style.display = "none";
      if (streak >= RESTRAINT_PUZZLE_STREAK_REQUIRED) {
        state.puzzleDone = true;
        input.disabled = true;
        const btn = document.getElementById("puzzleSubmitBtn");
        if (btn) btn.disabled = true;
        renderPuzzleProgress();
        maybeUnlock();
        return;
      }
      currentPuzzle = generateHardPuzzle();
      renderPuzzleQuestion();
      input.value = "";
      input.focus();
    } else {
      streak = 0;
      currentPuzzle = generateHardPuzzle();
      renderPuzzleQuestion();
      input.value = "";
      input.focus();
      if (err) err.style.display = "block";
    }
  }

  document.getElementById("puzzleSubmitBtn").addEventListener("click", checkPuzzle);
  document.getElementById("puzzleInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      checkPuzzle();
    }
  });

  // --- Step 3: genuine written reason ---
  const reasonInput = document.getElementById("reasonInput");
  const reasonErr = document.getElementById("reasonErr");

  function checkReason() {
    const result = validateOpenReason(reasonInput.value);
    state.reasonDone = result.valid;
    if (reasonErr) {
      reasonErr.style.display = result.valid ? "none" : "block";
      reasonErr.textContent = result.message;
    }
    if (result.valid) maybeUnlock();
  }

  reasonInput.addEventListener("input", checkReason);

  continueBtn.addEventListener("click", async () => {
    if (continueBtn.disabled) return;
    continueBtn.disabled = true;
    continueBtn.textContent = "Opening website...";

    let currentTabId = tabId;
    if (!currentTabId && typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.getCurrent) {
      try {
        const t = await chrome.tabs.getCurrent();
        if (t?.id) currentTabId = t.id;
      } catch {
        /* ignore */
      }
    }

    try {
      if (typeof grantRestraintPass === "function") {
        await grantRestraintPass(site, 15, currentTabId);
      }
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: "GRANT_RESTRAINT_PASS", domain: site, durationMinutes: 15, tabId: currentTabId },
            () => {
              if (chrome.runtime.lastError) {
                /* ignore if background worker is inactive */
              }
              resolve();
            }
          );
        });
      }
    } catch (err) {
      console.error("[Stoic] Error granting restraint pass:", err);
    }

    window.location.href = destUrl || `https://${site}`;
  });
}

document.getElementById("closeBtn").addEventListener("click", async () => {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  const tab = await chrome.tabs.getCurrent();

  if (tab?.id) {
    chrome.tabs.remove(tab.id);
  } else {
    window.close();
  }
});

main();
