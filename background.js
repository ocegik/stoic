// ---- Storage shape (per domain key in `sites`) ----
// {
//   mode: "limit" | "block",
//   limitMinutes: number,
//   usedSeconds: number,        // accumulated today
//   lastReset: "YYYY-MM-DD",
//   history: [{date, seconds}], // up to 6 prior days, most recent last
//   action: "page" | "redirect",
//   redirectUrl: string,
//   paused: boolean,
//   schedule: {
//     days: number[],           // JS day indexes, 0=Sun … 6=Sat
//     startTime: "HH:MM" | "",  // optional local focus-hours window
//     endTime: "HH:MM" | "",
//     dayLimits: { [day]: number } // optional per-day moderation limits
//   },
//   timesTripped: number,       // all-time count of times the breaker tripped
//   notified80: boolean,        // pre-limit warnings sent today
//   notified90: boolean,
//   createdAt: "YYYY-MM-DD"
// }

// todayStr()/getSites()/saveSites() live in common.js; the pure,
// storage-free tracking logic (ensureReset, matchSite, elapsed-time
// clamping, threshold checks) lives in background-logic.js so the test
// suite can exercise it without a Chrome environment. Service workers
// can't use <script> tags, so pull both in with importScripts.
importScripts("common.js", "background-logic.js");

const TICK_ALARM = "site-limiter-tick";

const WARNING_COPY = {
  80: {
    title: "A natural point to pause",
    body: (site, limitMinutes) =>
      `${limitMinutes} min today on ${site} — 80% used. Worth deciding now, on your own terms, rather than later.`,
  },
  90: {
    title: "Close to today's limit",
    body: (site, limitMinutes) =>
      `${limitMinutes} min today on ${site} — 90% used. A few minutes left before the choice gets made for you.`,
  },
};

let activeState = { tabId: null, domain: null, windowFocused: true, lastAccountedAt: Date.now() };

// Reads the currently focused window's active tab. Chrome-API calls only —
// no storage IO — so it's safe to run before we've decided whether this
// tick needs to touch storage at all.
async function resolveActiveTab() {
  const wins = await chrome.windows.getAll({ populate: false });
  const focusedWin = wins.find((w) => w.focused);
  if (!focusedWin) return { tabId: null, domain: null, windowFocused: false };

  const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWin.id });
  if (!tab || !tab.url) return { tabId: null, domain: null, windowFocused: true };

  return { tabId: tab.id, domain: getDomain(tab.url), windowFocused: true };
}

async function notifyThreshold(key, entry, pct, limitMinutes) {
  const copy = WARNING_COPY[pct];
  if (!copy) return;
  try {
    await chrome.notifications.create(`stoic-${key}-${pct}-${entry.lastReset}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: copy.title,
      message: copy.body(key, limitMinutes || 0),
      priority: 0,
    });
  } catch (err) {
    // Notifications are a nice-to-have; never let a failure here block
    // the tracking/blocking logic that already ran.
    console.error("[Stoic] notification failed", err);
  }
}

async function navigateAfterTrip(tabId, key, entry, reason) {
  if (entry.action === "redirect") {
    const dest = normalizeUrl(entry.redirectUrl);
    if (dest) {
      try {
        await chrome.tabs.update(tabId, { url: dest });
        return;
      } catch {
        /* tab may be gone, fall through to the reality-check page */
      }
    }
  }
  const url = chrome.runtime.getURL(
    `blocked.html?site=${encodeURIComponent(key)}&reason=${encodeURIComponent(reason)}`
  );
  try {
    await chrome.tabs.update(tabId, { url });
  } catch {
    /* tab may be gone */
  }
}

function isTrackableDomain(domain) {
  if (!domain || typeof domain !== "string") return false;
  const d = domain.toLowerCase().trim();
  if (d.includes(" ") || d.includes(":") || d.includes("/")) return false;
  if (d.startsWith("chrome") || d.startsWith("edge") || d.startsWith("about") || d.startsWith("devtools")) return false;
  if (d === "newtab" || d === "extensions") return false;
  return d.includes(".") || d === "localhost";
}

// Single entry point for both "how long has the active tab been open"
// tracking and "should we block/warn right now" checks. Sites are loaded
// once at the top and saved once at the end — never more than one
// read-modify-write round trip to storage per call.
async function tick() {
  const current = await resolveActiveTab();
  const previous = activeState;
  const now = Date.now();

  // Only carry the "session start" timestamp forward if this is genuinely
  // the same tracking session as last time (same focused window, same
  // tab, same domain). Anything else (a switch, a navigation, regaining
  // focus) starts the clock fresh so we never credit time from before it.
  const sameSession =
    previous.windowFocused && previous.tabId === current.tabId && previous.domain === current.domain;
  const lastAccountedAt = sameSession ? previous.lastAccountedAt : now;
  const elapsedSeconds = clampElapsed((now - lastAccountedAt) / 1000);

  activeState = { ...current, lastAccountedAt: now };

  if (!current.domain || !current.windowFocused || !isTrackableDomain(current.domain)) return;

  // ---- the one storage round trip for this tick ----
  const sites = await getSites();
  let key = matchSite(current.domain, sites);
  if (!key) {
    key = current.domain;
    sites[key] = {
      mode: "unconstrained",
      limitMinutes: 0,
      usedSeconds: 0,
      lastReset: todayStr(),
      history: [],
      createdAt: todayStr(),
    };
  }

  const entry = sites[key];
  const rolledOver = ensureReset(entry);

  if (entry.mode === "unconstrained") {
    entry.usedSeconds = (entry.usedSeconds || 0) + elapsedSeconds;
    await saveSites(sites);
    return;
  }

  const activeRule = getActiveRule(entry, new Date(now));

  if (!activeRule.active) {
    if (rolledOver) await saveSites(sites); // persist a possible day-rollover
    return;
  }

  let tripReason = null;

  if (entry.mode === "block") {
    tripReason = "blocked";
  } else if (entry.mode === "limit") {
    entry.usedSeconds = (entry.usedSeconds || 0) + elapsedSeconds;
    const limitSeconds = (activeRule.limitMinutes || 0) * 60;

    const crossed = crossedThreshold(entry, limitSeconds);
    if (crossed) {
      markThresholdsUpTo(entry, crossed.pct);
      notifyThreshold(key, entry, crossed.pct, activeRule.limitMinutes); // fire-and-forget; no storage IO
    }

    if (entry.usedSeconds >= limitSeconds) {
      tripReason = "limit";
    }
  }

  if (tripReason) {
    entry.timesTripped = (entry.timesTripped || 0) + 1;
    entry.lastTrippedAt = Date.now();
  }

  await saveSites(sites);

  if (tripReason) {
    activeState.domain = null; // stop crediting a tab we just blocked/redirected away from
    await navigateAfterTrip(current.tabId, key, entry, tripReason);
  }
}

// ---------- concurrency guard ----------
// tick() is triggered from several independent event sources (the
// periodic alarm, tab activation, tab URL updates, window focus changes,
// plus the initial call on worker startup). Without a guard, two
// overlapping ticks could both read the same stale `sites` snapshot and
// race to write it back, silently dropping one of the updates (e.g.
// undercounting usedSeconds, or missing a trip). createCoalescingRunner
// (background-logic.js) makes sure at most one tick runs at a time.
const runTick = createCoalescingRunner(tick, (err) => console.error("[Stoic] tick failed", err));

chrome.alarms.create(TICK_ALARM, { periodInMinutes: CHECK_INTERVAL_SECONDS / 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) runTick();
});

chrome.tabs.onActivated.addListener(() => runTick());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) runTick();
});
chrome.windows.onFocusChanged.addListener(() => runTick());

runTick();
