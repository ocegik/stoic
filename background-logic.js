// ---------- background-logic.js ----------
// Pure, storage-free logic pulled out of background.js so it can be
// exercised directly by the test suite (see test/) without needing a real
// Chrome extension environment (no chrome.* APIs are touched anywhere in
// this file).
//
// Loaded two different ways, same trick as common.js:
//   - background.js (a classic service worker) pulls it in with
//     importScripts("common.js", "background-logic.js"), which installs
//     everything below as globals in the worker's scope.
//   - test/*.test.js pull it in with require("../background-logic.js")
//     under Node, which uses the CommonJS export at the bottom instead.

// Requested alarm period. Chrome only honors sub-30s periods for unpacked
// (developer-mode) extensions; once packed/published it enforces a ~30s
// minimum regardless of what we ask for. Tracking below never assumes
// either cadence — it measures real elapsed time on every tick.
const CHECK_INTERVAL_SECONDS = 5;
// Worst-case realistic gap between ticks once packed (Chrome's enforced
// alarm minimum). Real elapsed time is trusted up to ~2x this; anything
// beyond that (e.g. the computer was asleep) is clamped so a long gap
// can't silently credit hours of "usage".
const PACKED_ALARM_MINIMUM_SECONDS = 30;
const MAX_ELAPSED_SECONDS = PACKED_ALARM_MINIMUM_SECONDS * 2;
const MAX_HISTORY_DAYS = 6;

// Pre-limit warning thresholds, checked highest-first so a single big
// elapsed jump (e.g. after sleep/wake) that clears both at once only ever
// reports the more informative one.
const WARNING_THRESHOLDS = [
  { pct: 90, flag: "notified90" },
  { pct: 80, flag: "notified80" },
];

// todayStr() lives in common.js. In the service worker it's already a
// global by the time this file loads (importScripts runs common.js first).
// Under Node, pull it in via require instead.
const getTodayKey =
  typeof module !== "undefined" && module.exports
    ? require("./common.js").todayStr
    : self.todayStr;

function getDomain(url) {
  try {
    const u = new URL(url);
    if (!u.hostname) return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Finds the tracked site key that best matches `domain` — exact match, or
// `domain` being a subdomain of a tracked key (adding youtube.com also
// covers m.youtube.com). Ties broken in favor of the longer (more
// specific) key.
function matchSite(domain, sites) {
  if (!domain) return null;
  let best = null;
  for (const key of Object.keys(sites)) {
    if (domain === key || domain.endsWith("." + key)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best;
}

// Rolls a tracked-site entry over to a new day: archives yesterday's
// usedSeconds into `history` (capped at MAX_HISTORY_DAYS), zeroes the
// counter, and clears the pre-limit warning flags so they can fire again
// today. No-op if `entry` is already current. Mutates `entry` in place.
function ensureReset(entry, today = getTodayKey()) {
  if (entry.lastReset === today) return false;

  if (entry.usedSeconds > 0) {
    entry.history = entry.history || [];
    entry.history.push({ date: entry.lastReset, seconds: entry.usedSeconds });
    if (entry.history.length > MAX_HISTORY_DAYS) {
      entry.history = entry.history.slice(entry.history.length - MAX_HISTORY_DAYS);
    }
  }
  entry.usedSeconds = 0;
  entry.lastReset = today;
  entry.notified80 = false;
  entry.notified90 = false;
  return true;
}

function normalizeUrl(raw) {
  let u = (raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    new URL(u);
    return u;
  } catch {
    return null;
  }
}

// Clamps a raw elapsed-seconds reading into the range we're willing to
// credit as real usage, so a long gap between ticks (sleep/wake, a
// suspended service worker waking back up, a missed alarm) can't turn
// into hours of phantom usage, and a clock going backwards can't go
// negative.
function clampElapsed(rawSeconds) {
  return Math.max(0, Math.min(rawSeconds, MAX_ELAPSED_SECONDS));
}

// Returns the highest-percentage warning threshold that `entry` has
// reached but not yet been notified about, or null if none applies (no
// limit set, below 80%, or every applicable threshold already notified).
function crossedThreshold(entry, limitSeconds) {
  if (!limitSeconds || limitSeconds <= 0) return null;
  const usedSeconds = entry.usedSeconds || 0;
  for (const t of WARNING_THRESHOLDS) {
    if (!entry[t.flag] && usedSeconds / limitSeconds >= t.pct / 100) {
      return t;
    }
  }
  return null;
}

// Marks every threshold at or below `pct` as notified, so jumping straight
// past 90% in one tick doesn't leave the 80% flag unset (and eligible to
// fire a now-redundant notification later).
function markThresholdsUpTo(entry, pct) {
  for (const t of WARNING_THRESHOLDS) {
    if (t.pct <= pct) entry[t.flag] = true;
  }
}

// A small execution guard for the situation background.js is in: a task
// (tick()) gets triggered from several independent, possibly-overlapping
// event sources, but must never run twice concurrently, since it does a
// read-modify-write cycle against shared storage and in-memory state.
//
// Rather than queuing every call — which could pile up an unbounded
// backlog under a burst of tab events — this coalesces: at most one run
// is in flight at a time, and at most one more is remembered to run
// immediately after it finishes, enough to pick up whatever changed
// during the in-flight run without growing a backlog of stale re-runs.
function createCoalescingRunner(task, onError) {
  let inFlight = false;
  let queued = false;

  async function run() {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      await task();
    } catch (err) {
      if (onError) onError(err);
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        run();
      }
    }
  }

  return run;
}

const backgroundLogicApi = {
  CHECK_INTERVAL_SECONDS,
  PACKED_ALARM_MINIMUM_SECONDS,
  MAX_ELAPSED_SECONDS,
  MAX_HISTORY_DAYS,
  WARNING_THRESHOLDS,
  getDomain,
  matchSite,
  ensureReset,
  normalizeUrl,
  clampElapsed,
  crossedThreshold,
  markThresholdsUpTo,
  createCoalescingRunner,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = backgroundLogicApi;
} else {
  Object.assign(self, backgroundLogicApi);
}
