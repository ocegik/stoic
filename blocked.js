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

document.getElementById("closeBtn").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();

  if (tab?.id) {
    chrome.tabs.remove(tab.id);
  } else {
    window.close();
  }
});

main();
