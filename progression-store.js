// ---------- progression-store.js ----------
// Storage IO + schema/migration for the progression system. Owns the one
// storage key, the default state shape, an in-memory cache kept fresh by
// chrome.storage.onChanged, a debounced writer, and the message helper used
// by non-worker contexts to ask the worker to do something. Everything here
// touches chrome.* or is a thin wrapper around it, mirroring the split
// common.js already has between pure helpers and getSites()/saveSites().
//
// Loaded the same three ways as every other classic script in this codebase:
//   - background.js pulls it in with importScripts(...), after common.js
//     and progression-model.js.
//   - popup.html / options.html / blocked.html load it with a <script> tag,
//     after common.js and progression-model.js.
//   - test files require() it directly under Node.
//
// I2 (chrome.storage.local, unconditionally) and I1 (only the service
// worker writes) both live in this file; nothing above or below it needs to
// know the storage key or re-derive either invariant.

const { todayStr } =
  typeof module !== "undefined" && module.exports ? require("./common.js") : self;

const { PROGRESSION_SCHEMA_VERSION, DEFAULT_LEISURE_CEILING_MINUTES, DEFAULT_FOCUS_TARGET, MIN_TRACKED_MINUTES_FOR_FOCUS } =
  typeof module !== "undefined" && module.exports ? require("./progression-model.js") : self;

const PROGRESSION_KEY = "progression";
const SAVE_DEBOUNCE_MS = 2000;

// Only the worker calls importScripts; every page context (popup, options,
// blocked) does not. This is the same discriminator background.js's own
// load order relies on, and it is what lets scheduleProgressionSave() and
// saveProgression() refuse to write from a page without needing a message
// round trip just to find out where they're running (I1).
function isServiceWorkerContext() {
  return typeof importScripts === "function";
}

function defaultProgressionState() {
  return {
    version: PROGRESSION_SCHEMA_VERSION,

    level: {
      xp: 0,
      level: 1,
      rankId: "observer",
      lastLevelUp: null,
    },

    streaks: {
      discipline: {
        current: 0,
        currentStart: null,
        best: 0,
        bestStart: null,
        bestEnd: null,
        lastHeldDate: null,
        lastBrokenFrom: 0,
      },
      rules: {},
    },

    lifetime: {
      firstDay: null,
      daysTracked: 0,
      daysHeld: 0,
      trackedSeconds: 0,
      productiveSeconds: 0,
      generalSeconds: 0,
      leisureSeconds: 0,
      gatesShown: 0,
      gatesPassed: 0,
      refusals: 0,
      refusalsByDomain: {},
      violations: 0,
      rulesCreated: 0,
      rulesLoosened: 0,
      xpFromDays: 0,
      xpFromWeeks: 0,
      xpFromAchievements: 0,
    },

    records: {},
    achievements: {},

    days: [],
    weeks: [],
    months: [],

    settlement: {
      lastSettledDate: null,
      lastRunAt: null,
      lastWeekSettled: null,
    },

    today: {
      date: todayStr(),
      gatesShown: {},
      gatesPassed: {},
    },

    config: {
      leisureCeilingMinutes: DEFAULT_LEISURE_CEILING_MINUTES,
      focusTarget: DEFAULT_FOCUS_TARGET,
      minTrackedMinutesForFocus: MIN_TRACKED_MINUTES_FOR_FOCUS,
    },
  };
}

// v1 is the floor — there is nothing older to migrate from yet. This
// function's job going forward is to backfill fields a later schema bump
// adds, one nested section at a time, so a stored state that predates a
// change still loads with sane defaults. It must never touch days/weeks/
// months beyond copying them through unchanged: settled days are immutable
// (I3), and a migration that "corrected" one would silently break that.
function migrateProgressionState(raw) {
  const base = defaultProgressionState();
  if (!raw || typeof raw !== "object") return base;

  const rawStreaks = raw.streaks || {};
  const rawSettlement = raw.settlement || {};

  const merged = {
    ...base,
    ...raw,
    version: PROGRESSION_SCHEMA_VERSION,
    level: { ...base.level, ...(raw.level || {}) },
    streaks: {
      discipline: { ...base.streaks.discipline, ...(rawStreaks.discipline || {}) },
      rules: { ...(rawStreaks.rules || {}) },
    },
    lifetime: { ...base.lifetime, ...(raw.lifetime || {}) },
    records: { ...(raw.records || {}) },
    achievements: { ...(raw.achievements || {}) },
    days: Array.isArray(raw.days) ? raw.days : [],
    weeks: Array.isArray(raw.weeks) ? raw.weeks : [],
    months: Array.isArray(raw.months) ? raw.months : [],
    settlement: { ...base.settlement, ...rawSettlement },
    today: raw.today && raw.today.date ? { ...base.today, ...raw.today } : base.today,
    config: { ...base.config, ...(raw.config || {}) },
  };

  return merged;
}

// Kept fresh by the onChanged listener below so repeated reads within a
// context (several renders in the same popup open, several events in the
// same worker tick) don't each pay a storage round trip — the same reason
// common.js caches the storage-area preference.
let cachedState = null;
let saveTimer = null;

async function loadProgression() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    if (!cachedState) cachedState = defaultProgressionState();
    return cachedState;
  }
  const { [PROGRESSION_KEY]: raw } = await chrome.storage.local.get(PROGRESSION_KEY);
  cachedState = migrateProgressionState(raw);
  return cachedState;
}

// I2: always chrome.storage.local, never whatever `sites` is currently
// using — progression is a per-device journal and, per audit §6.5, `sites`
// already risks the sync quota on its own.
async function saveProgression(state) {
  cachedState = state;
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  // I1: pages read through this module but never write. A write attempted
  // from a page context is a bug, not a case to silently support.
  if (!isServiceWorkerContext()) {
    console.warn("[Stoic] saveProgression called outside the service worker; ignoring.");
    return;
  }
  await chrome.storage.local.set({ [PROGRESSION_KEY]: state });
}

// Debounced so a burst of events (several gate_shown/gate_passed messages
// in quick succession) coalesces into one write, the same reasoning as
// tick()'s single read-modify-write per call. flushProgressionSave() forces
// it early — settlement calls that before it needs the latest state.
function scheduleProgressionSave(state) {
  cachedState = state;
  if (!isServiceWorkerContext()) return; // I1, same guard as saveProgression
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveProgression(cachedState).catch((err) => console.error("[Stoic] progression save failed", err));
  }, SAVE_DEBOUNCE_MS);
}

async function flushProgressionSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (cachedState) await saveProgression(cachedState);
}

// Synchronous read for renderers: popup/options render on every
// storage.onChanged tick and can't await a round trip on the hot path.
// Callers that need the authoritative state (the worker, before settling)
// use loadProgression() instead.
function getProgressionSync() {
  return cachedState || defaultProgressionState();
}

// The only way a page context ever mutates progression state: post a
// message and let the worker apply it (I1). Errors are swallowed the same
// way blocked.js already swallows them when granting a restraint pass — the
// worker may not have a listener up yet, or the page may be navigating away,
// and neither is worth surfacing to the user.
async function sendProgressionEvent(type, payload) {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "PROGRESSION_EVENT", eventType: type, payload }, () => {
        if (chrome.runtime.lastError) {
          /* ignore — no receiving end (worker asleep/not yet installed) */
        }
        resolve();
      });
    });
  } catch {
    /* ignore */
  }
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.prototype.hasOwnProperty.call(changes, PROGRESSION_KEY)) {
      cachedState = migrateProgressionState(changes[PROGRESSION_KEY].newValue);
    }
  });
}

const progressionStoreApi = {
  PROGRESSION_KEY,
  defaultProgressionState,
  migrateProgressionState,
  loadProgression,
  saveProgression,
  scheduleProgressionSave,
  flushProgressionSave,
  getProgressionSync,
  sendProgressionEvent,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = progressionStoreApi;
} else {
  Object.assign(self, progressionStoreApi);
}
