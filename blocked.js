const params = new URLSearchParams(window.location.search);
const site = params.get("site") || "this site";
const reason = params.get("reason") || "blocked";

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
    const rawRestraintType = params.get("restraintType") || entry.restraintType || "countdown";
    const countdownSec = Number(params.get("countdownSeconds")) || entry.countdownSeconds || 15;
    const targetUrl = params.get("targetUrl") || `https://${site}`;

    eyebrowStatus.textContent = "MINDFUL PAUSE · RESTRAINT MODE";
    headline.textContent = `Reconsider opening ${getDomainDisplayName(site)}`;
    subhead.innerHTML = `Stoic Restraint Mode is active for <span class="site">${site}</span>. Take a moment to reflect before proceeding.`;
    statRow.innerHTML = `
      <div class="stat-cell"><div class="stat-value">${timesTripped}</div><div class="stat-label">Times paused</div></div>
    `;
    equivalency.textContent = "Intentionally pausing before opening a website breaks automatic habits.";

    setupRestraintChallenge(site, rawRestraintType, countdownSec, targetUrl);
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

function setupRestraintChallenge(site, rawType, sec, destUrl) {
  const restraintBox = document.getElementById("restraintBox");
  const restraintBadge = document.getElementById("restraintBadge");
  const restraintWidget = document.getElementById("restraintWidget");
  const continueBtn = document.getElementById("continueBtn");
  const closeBtn = document.getElementById("closeBtn");
  const placardBox = document.getElementById("placardBox");

  if (!restraintBox || !restraintWidget || !continueBtn) return;

  restraintBox.style.display = "flex";
  continueBtn.style.display = "inline-flex";
  continueBtn.disabled = true;
  if (closeBtn) closeBtn.textContent = "Go back";

  const resolvedType = resolveRestraintType(rawType);
  const displayName = getDomainDisplayName(site);

  function unlockChallenge() {
    continueBtn.disabled = false;
    continueBtn.textContent = `Continue to ${displayName}`;
    continueBtn.classList.remove("btn-ghost");
    continueBtn.classList.add("btn-accent");
  }

  continueBtn.addEventListener("click", async () => {
    if (continueBtn.disabled) return;
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        await chrome.runtime.sendMessage({ type: "GRANT_RESTRAINT_PASS", domain: site, durationMinutes: 15 });
      } catch {
        /* ignore */
      }
    }
    window.location.href = destUrl || `https://${site}`;
  });

  if (resolvedType === "countdown") {
    if (restraintBadge) restraintBadge.textContent = "COUNTDOWN RESTRAINT";
    let rem = Math.max(5, Math.min(60, sec));
    const circumference = 251.2;
    restraintWidget.innerHTML = `
      <div class="countdown-timer-wrap">
        <svg viewBox="0 0 90 90" class="countdown-svg">
          <circle cx="45" cy="45" r="40" class="countdown-ring-bg" />
          <circle cx="45" cy="45" r="40" class="countdown-ring-fill" id="countdownRing" />
        </svg>
        <span class="countdown-number" id="countdownVal">${rem}</span>
      </div>
      <div style="font-size: 13px; color: var(--text-muted);">Pause for ${rem} seconds before continuing.</div>
    `;

    const ringFill = document.getElementById("countdownRing");
    const valEl = document.getElementById("countdownVal");
    const initialSec = rem;

    const interval = setInterval(() => {
      rem--;
      if (valEl) valEl.textContent = rem > 0 ? rem : "0";
      if (ringFill) {
        const offset = circumference * (1 - rem / initialSec);
        ringFill.style.strokeDashoffset = String(offset);
      }
      continueBtn.textContent = rem > 0 ? `Wait ${rem}s...` : `Continue to ${displayName}`;

      if (rem <= 0) {
        clearInterval(interval);
        unlockChallenge();
      }
    }, 1000);

  } else if (resolvedType === "confirmation") {
    if (restraintBadge) restraintBadge.textContent = "TRIPLE CONFIRMATION";
    const steps = [
      { q: `Are you sure you want to open ${displayName}?`, btn: "Yes, I am sure →" },
      { q: `Is this the best use of your attention right now?`, btn: "Yes, proceed →" },
      { q: `Last chance: Will this bring value to your day?`, btn: "Complete Challenge →" },
    ];
    let curStep = 0;

    function renderStep() {
      const step = steps[curStep];
      restraintWidget.innerHTML = `
        <div class="confirmation-step-box">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-faint); text-transform: uppercase;">Step ${curStep + 1} of ${steps.length}</div>
          <div class="confirm-question">${step.q}</div>
          <button type="button" class="btn-ghost confirm-btn" id="confirmNextBtn">${step.btn}</button>
        </div>
      `;
      document.getElementById("confirmNextBtn").addEventListener("click", () => {
        curStep++;
        if (curStep < steps.length) {
          renderStep();
        } else {
          restraintWidget.innerHTML = `<div style="color: var(--sem-green); font-weight: 700; padding: 10px;">✓ Confirmation challenge completed!</div>`;
          unlockChallenge();
        }
      });
    }
    renderStep();

  } else if (resolvedType === "quote") {
    if (restraintBadge) restraintBadge.textContent = "STOIC REFLECTION";
    if (placardBox) placardBox.style.display = "block";
    restraintWidget.innerHTML = `
      <div style="font-size: 13.5px; color: var(--text-muted); text-align: center; margin: 6px 0;">Read the reflection below thoughtfully.</div>
      <button type="button" class="btn-ghost" id="quoteAckBtn" style="padding: 8px 16px; font-size: 12.5px;">I have read & reflected</button>
    `;
    document.getElementById("quoteAckBtn").addEventListener("click", () => {
      restraintWidget.innerHTML = `<div style="color: var(--sem-green); font-weight: 700; padding: 10px;">✓ Reflection acknowledged!</div>`;
      unlockChallenge();
    });

  } else if (resolvedType === "reflection") {
    if (restraintBadge) restraintBadge.textContent = "REFLECTION QUESTION";
    const randomQ = REFLECTION_QUESTIONS[Math.floor(Math.random() * REFLECTION_QUESTIONS.length)];
    restraintWidget.innerHTML = `
      <div class="reflection-box">
        <div class="reflection-q">"${randomQ}"</div>
        <input type="text" class="reflection-input" id="reflectionInput" placeholder="Type a brief answer or intention..." />
        <div style="display: flex; gap: 8px; width: 100%; margin-top: 4px;">
          <button type="button" class="btn-ghost" id="reflectSubmitBtn" style="flex: 1; padding: 8px;">Submit Answer</button>
        </div>
      </div>
    `;

    const input = document.getElementById("reflectionInput");
    const submitBtn = document.getElementById("reflectSubmitBtn");

    function finishReflection() {
      restraintWidget.innerHTML = `<div style="color: var(--sem-green); font-weight: 700; padding: 10px;">✓ Intention recorded!</div>`;
      unlockChallenge();
    }

    submitBtn.addEventListener("click", () => finishReflection());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finishReflection();
    });

  } else if (resolvedType === "math") {
    if (restraintBadge) restraintBadge.textContent = "MATH CHALLENGE";
    let currentPuzzle = generateMathPuzzle();

    function renderMath() {
      restraintWidget.innerHTML = `
        <div class="math-puzzle-box">
          <div style="font-size: 12px; color: var(--text-muted);">Solve this quick problem to unlock:</div>
          <div class="math-question">${currentPuzzle.question}</div>
          <input type="number" class="math-input" id="mathInput" placeholder="?" autofocus />
          <div id="mathErr" style="color: var(--sem-red); font-size: 11.5px; display: none;">Incorrect answer. Try this new question:</div>
          <button type="button" class="btn-ghost" id="mathSubmitBtn" style="padding: 8px 16px;">Check Answer</button>
        </div>
      `;

      const input = document.getElementById("mathInput");
      const err = document.getElementById("mathErr");
      const btn = document.getElementById("mathSubmitBtn");

      function check() {
        const val = Number(input.value);
        if (val === currentPuzzle.answer) {
          restraintWidget.innerHTML = `<div style="color: var(--sem-green); font-weight: 700; padding: 10px;">✓ Correct answer!</div>`;
          unlockChallenge();
        } else {
          currentPuzzle = generateMathPuzzle();
          renderMath();
          const newErr = document.getElementById("mathErr");
          if (newErr) newErr.style.display = "block";
        }
      }

      btn.addEventListener("click", check);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") check();
      });
    }
    renderMath();
  }
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
