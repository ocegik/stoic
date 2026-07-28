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
// suite can exercise it without a Chrome environment; the whole YouTube
// classification subsystem lives in youtube-classifier.js, which must load
// after common.js because it builds on the classification framework there.
// The progression system's pure model, storage layer and orchestration
// (progression-model.js / progression-store.js / progression-engine.js)
// load last, in that order, since each references globals the previous one
// installs (02-ARCHITECTURE.md §2). Service workers can't use <script>
// tags, so pull them all in with importScripts.
importScripts(
  "common.js",
  "youtube-classifier.js",
  "background-logic.js",
  "progression-model.js",
  "progression-store.js",
  "progression-engine.js"
);

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
  // The gate being shown at all — regardless of which of the three reasons
  // triggered it, and regardless of whether the user ends up redirected or
  // shown the reality-check page — is a refusal candidate the moment the
  // user backs away from it (01-PRODUCT-DESIGN.md §2.5). Record it before
  // any navigation so the count is never lost to a tab that closes mid-trip.
  await recordEvent("gate_shown", { domain: key, reason });

  if (entry.action === "redirect" && reason !== "restraint") {
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
  let targetUrl = "";
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url && !tab.url.includes("blocked.html")) {
        targetUrl = tab.url;
      }
    } catch {
      /* ignore */
    }
  }
  if (!targetUrl) targetUrl = `https://${key}`;

  let url = chrome.runtime.getURL(
    `blocked.html?site=${encodeURIComponent(key)}&reason=${encodeURIComponent(reason)}`
  );
  if (reason === "restraint") {
    url = chrome.runtime.getURL(
      `blocked.html?site=${encodeURIComponent(key)}&reason=restraint&targetUrl=${encodeURIComponent(targetUrl)}`
    );
  }

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

  // Single place that credits elapsed time, so the plain counter and the
  // per-content attribution can never diverge. For YouTube the seconds are
  // additionally booked against the video (or channel) actually on screen;
  // the category is resolved later, at read time, which is what lets a
  // re-classification retroactively correct today's analytics.
  const creditUsage = (seconds) => {
    if (!(seconds > 0)) return;
    entry.usedSeconds = (entry.usedSeconds || 0) + seconds;
    if (isYouTubeDomain(current.domain)) {
      const meta = latestYouTubeMetadataByTab[current.tabId] || null;
      creditYouTubeSeconds(entry, attributionKeyForContext(meta), seconds, todayStr());
    }
  };

  if (entry.mode === "unconstrained") {
    creditUsage(elapsedSeconds);
    await saveSites(sites);
    if (rolledOver) runSettlement(); // fire-and-forget: settle yesterday now that it's archived
    return;
  }

  const activeRule = getActiveRule(entry, new Date(now));

  if (!activeRule.active) {
    if (rolledOver) {
      await saveSites(sites); // persist a possible day-rollover
      runSettlement(); // fire-and-forget
    }
    return;
  }

  let tripReason = null;

  if (entry.mode === "block") {
    tripReason = "blocked";
  } else if (entry.mode === "restraint") {
    const hasPass = await hasActiveRestraintPass(key, current.tabId);
    if (!hasPass) {
      tripReason = "restraint";
    } else {
      creditUsage(elapsedSeconds);
    }
  } else if (entry.mode === "limit") {
    creditUsage(elapsedSeconds);
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
  if (rolledOver) runSettlement(); // fire-and-forget: settle yesterday now that it's archived

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
let latestYouTubeMetadataByTab = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GRANT_RESTRAINT_PASS") {
    const tabId = message.tabId || sender.tab?.id;
    grantRestraintPass(message.domain, message.durationMinutes || 15, tabId)
      .then((pass) => {
        // The moment the friction gate is pushed through, not merely shown
        // (01-PRODUCT-DESIGN.md §2.5) — recorded alongside the pass grant so
        // settlement can reconcile gatesShown - gatesPassed into refusals.
        recordEvent("gate_passed", { domain: message.domain });
        runTick();
        sendResponse({ success: true, pass });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "PROGRESSION_EVENT") {
    recordEvent(message.eventType, message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "REQUEST_SETTLEMENT") {
    runSettlement()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // A whole-state restore from a backup file, not an incremental event —
  // options.js already checked the schema version is one this build
  // understands before sending it (03-IMPLEMENTATION-SPEC.md §6.2: replace
  // or skip, never merge). Still worker-only per I1: the page hands over
  // the raw object, migrateProgressionState + saveProgression do the actual
  // write, same as every other path into progression-store.js.
  if (message.type === "RESTORE_PROGRESSION") {
    saveProgression(migrateProgressionState(message.state))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "YOUTUBE_METADATA_UPDATE") {
    const tabId = sender.tab?.id || activeState.tabId;
    if (tabId && message.metadata) {
      latestYouTubeMetadataByTab[tabId] = message.metadata;
      recordYouTubeVisit(message.metadata)
        .then(() => runTick())
        .catch((err) => console.error("[Stoic] recordYouTubeVisit failed", err));
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "GET_CLASSIFICATION_DEBUG_INFO") {
    handleGetDebugInfo().then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true; // async response
  }
});

// Everything the YouTube debugger needs about the tab currently in front of
// the user: what was extracted, which store lookups hit, and — most
// usefully when something looks wrong — the ordered trace of which
// precedence step produced the answer and why the earlier ones did not.
async function handleGetDebugInfo() {
  await ensureYouTubeStoresLoaded();
  const current = await resolveActiveTab();
  const sites = await getSites();

  if (!current.tabId || !current.domain) {
    return {
      domain: current.domain || null,
      url: null,
      metadata: null,
      channelLookup: { hit: false, channel: null },
      cacheStatus: "MISS",
      trace: [],
      attributionKey: null,
      classification: { macro: "General", micro: "General Browsing", confidence: 0.5, source: "fallback" },
    };
  }

  let tabUrl = null;
  try {
    const tab = await chrome.tabs.get(current.tabId);
    tabUrl = tab.url;
  } catch {
    /* the tab may have closed between resolving and reading it */
  }

  const ytMeta = latestYouTubeMetadataByTab[current.tabId] || null;
  const contextInput = ytMeta || { domain: current.domain, url: tabUrl };

  // Extract once and classify from the extracted context, rather than
  // extracting a second time inside classifyContext().
  const context = defaultExtractorRegistry.extract(contextInput);
  const cacheStatus = defaultClassificationCache.get(context, sites) ? "HIT" : "MISS";
  const result = classifyContext(context, sites);

  let channelLookup = { hit: false, channel: null };
  let trace = [];
  let attributionKey = null;

  if (isYouTubeDomain(context.domain)) {
    attributionKey = attributionKeyForContext(context);
    trace = resolveYouTubeClassification(
      {
        domain: context.domain,
        videoId: context.videoId,
        channelId: context.channelId,
        channelName: context.channelName,
        title: context.title,
        contentType: context.contentType,
      },
      { sites }
    ).trace;

    const query = context.channelId || context.channelName;
    if (query) {
      const found =
        lookupChannelSync({ channelId: context.channelId, channelName: context.channelName }) ||
        lookupBuiltInChannel({ channelId: context.channelId, channelName: context.channelName });
      if (found) channelLookup = { hit: true, channel: found };
    }
  }

  return {
    domain: current.domain,
    url: tabUrl || context.url,
    metadata: {
      videoId: context.videoId || null,
      title: context.title || null,
      channelId: context.channelId || null,
      channelName: context.channelName || null,
      contentType: context.contentType || "video",
    },
    channelLookup,
    cacheStatus,
    trace,
    attributionKey,
    classification: result.toObject(),
  };
}

const runTick = createCoalescingRunner(tick, (err) => console.error("[Stoic] tick failed", err));
// Same coalescing guard as tick(): settlement is triggered from several
// independent sources (a day rollover mid-tick, the periodic alarm, an
// explicit REQUEST_SETTLEMENT message, worker startup) and must never run
// twice concurrently against the same progression state.
const runSettlement = createCoalescingRunner(settleThrough, (err) => console.error("[Stoic] settlement failed", err));

const SETTLE_ALARM = "stoic-progression-settle";

chrome.alarms.create(TICK_ALARM, { periodInMinutes: CHECK_INTERVAL_SECONDS / 60 });
chrome.alarms.create(SETTLE_ALARM, { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) runTick();
  if (alarm.name === SETTLE_ALARM) runSettlement();
});

chrome.tabs.onActivated.addListener(() => runTick());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  // A tab that has left YouTube must stop carrying its last video's
  // metadata around, or the next tick would keep attributing time to a
  // video that is no longer on screen (and the map would grow forever).
  if (!isYouTubeDomain(getDomain(changeInfo.url) || "")) {
    delete latestYouTubeMetadataByTab[tabId];
  }
  runTick();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  removeRestraintPassForTab(tabId);
  delete latestYouTubeMetadataByTab[tabId];
});
chrome.windows.onFocusChanged.addListener(() => runTick());

// Prime the YouTube stores so the very first tick after the worker wakes
// classifies against real data instead of an empty snapshot, then run tick
// and settlement once so a browser that was closed for a while catches up
// on both without waiting for the next alarm.
ensureYouTubeStoresLoaded()
  .catch((err) => console.error("[Stoic] priming YouTube stores failed", err))
  .finally(() => {
    runTick();
    runSettlement();
  });

runTick();

