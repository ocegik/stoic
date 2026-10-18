// ---------- common.js ----------
// Shared helpers used by background.js, popup.js, and blocked.js.
//
// This is loaded two different ways, so it has to stay a plain classic
// script (no import/export):
//   - popup.html / blocked.html load it with <script src="common.js"></script>
//     before their own script, so these become ordinary globals.
//   - background.js (a classic, non-module service worker) pulls it in with
//     importScripts("common.js"), which also installs these as globals in
//     the worker's scope.
// It's also require()-able from Node (see the export at the bottom), which
// is what lets the test suite exercise todayStr()/fmtMinutes() directly.

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Local date as "YYYY-MM-DD". Used as the key for daily reset/rollover
// logic everywhere usage is tracked or displayed.
function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayStr() {
  return dateKey(new Date());
}

function dateFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ---------- storage area (local vs. sync) ----------
// Everything reads/writes through here rather than touching
// chrome.storage.local directly, so the opt-in "sync across devices"
// setting (popup.js) transparently applies to background.js and
// blocked.js too. The preference flag itself always lives in
// chrome.storage.local — it's a per-install setting, not data we'd want
// silently propagating to a device that hasn't opted in yet.
const STORAGE_PREF_KEY = "storagePreference"; // "local" (default) | "sync"
const THEME_PREF_KEY = "themePreference"; // "light" (default) | "dark" | "system"

async function getThemePreference() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const { [THEME_PREF_KEY]: theme } = await chrome.storage.local.get(THEME_PREF_KEY);
    return theme || "light";
  }
  return "light";
}

async function setThemePreference(theme) {
  const val = theme === "dark" || theme === "system" ? theme : "light";
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [THEME_PREF_KEY]: val });
  }
  applyTheme(val);
}

function applyTheme(theme) {
  if (typeof document !== "undefined" && document.documentElement) {
    const val = theme === "dark" || theme === "system" || theme === "light" ? theme : "light";
    document.documentElement.setAttribute("data-theme", val);
  }
}

// Auto-apply theme on load in DOM environments
if (typeof document !== "undefined" && document.documentElement) {
  getThemePreference().then(applyTheme).catch(() => {});
}

// Listen for theme preference changes across contexts (popup, options, blocked)
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.prototype.hasOwnProperty.call(changes, THEME_PREF_KEY)) {
      const newTheme = changes[THEME_PREF_KEY].newValue || "light";
      applyTheme(newTheme);
    }
  });
}

// Cached after the first read so getSites()/saveSites() don't need an
// extra chrome.storage.local round trip on every single call — just once
// per context (service worker, popup, or blocked-page load), kept fresh
// after that via the onChanged listener below.
let cachedPreference = null;

async function getStoragePreference() {
  if (cachedPreference !== null) return cachedPreference;
  const { [STORAGE_PREF_KEY]: pref } = await chrome.storage.local.get(STORAGE_PREF_KEY);
  cachedPreference = pref === "sync" ? "sync" : "local";
  return cachedPreference;
}

async function setStoragePreference(pref) {
  cachedPreference = pref === "sync" ? "sync" : "local";
  await chrome.storage.local.set({ [STORAGE_PREF_KEY]: cachedPreference });
}

// If the preference changes in another context — e.g. toggled in the
// popup while the background service worker is already running — keep
// this context's cache from going stale.
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.prototype.hasOwnProperty.call(changes, STORAGE_PREF_KEY)) {
      cachedPreference = changes[STORAGE_PREF_KEY].newValue === "sync" ? "sync" : "local";
    }
  });
}

async function getStorageArea() {
  const pref = await getStoragePreference();
  return pref === "sync" ? chrome.storage.sync : chrome.storage.local;
}

// Read the `sites` map out of whichever storage area is active. Always
// resolves to an object, even before anything has ever been saved.
async function getSites() {
  const area = await getStorageArea();
  const { sites = {} } = await area.get("sites");
  return sites;
}

// Persist the `sites` map back to whichever storage area is active.
async function saveSites(sites) {
  const area = await getStorageArea();
  await area.set({ sites });
}

// Format a number of minutes as "Xh Ym", "Ym", or "<1 min" if positive under a minute.
function fmtMinutes(totalMinutes) {
  const num = Number(totalMinutes) || 0;
  if (num <= 0) return "0m";
  if (num > 0 && num < 0.95) return "<1 min";
  const m = Math.round(num);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h > 0) return `${h}h ${r}m`;
  return `${m}m`;
}

// Format seconds precisely (e.g., "45s", "<1 min", "12m", "1h 15m")
function fmtDuration(seconds) {
  const sec = Number(seconds) || 0;
  if (sec <= 0) return "0s";
  if (sec < 60) return `${Math.round(sec)}s`;
  return fmtMinutes(sec / 60);
}

// Ticking countdown: "45s", "4:05".
function fmtCountdown(seconds) {
  const sec = Math.max(0, Math.round(seconds));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function cleanPositiveMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function timeStringToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function normalizeSchedule(schedule) {
  const raw = schedule && typeof schedule === "object" ? schedule : {};
  const days = Array.isArray(raw.days)
    ? raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : ALL_DAYS.slice();
  const dayLimits = {};
  if (raw.dayLimits && typeof raw.dayLimits === "object") {
    Object.keys(raw.dayLimits).forEach((day) => {
      const dayIndex = Number(day);
      const minutes = cleanPositiveMinutes(raw.dayLimits[day]);
      if (Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex <= 6 && minutes) {
        dayLimits[String(dayIndex)] = minutes;
      }
    });
  }

  return {
    days: Array.from(new Set(days)),
    startTime: timeStringToMinutes(raw.startTime) !== null ? raw.startTime : "",
    endTime: timeStringToMinutes(raw.endTime) !== null ? raw.endTime : "",
    dayLimits,
  };
}

function isScheduleDay(entry, date = new Date()) {
  const schedule = normalizeSchedule(entry?.schedule);
  return schedule.days.includes(date.getDay());
}

function isWithinTimeWindow(entry, date = new Date()) {
  const schedule = normalizeSchedule(entry?.schedule);
  const start = timeStringToMinutes(schedule.startTime);
  const end = timeStringToMinutes(schedule.endTime);
  if (start === null && end === null) return true;

  const nowMinutes = date.getHours() * 60 + date.getMinutes();
  if (start !== null && end === null) return nowMinutes >= start;
  if (start === null && end !== null) return nowMinutes < end;
  if (start === end) return true;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

// Days not present in `dayLimits` are governed by the entry's own `mode`.
// A day that IS present is always treated as a limited-access exception for
// that day, regardless of the base mode — this is what lets "always closed"
// or "pause first" sites carry a "but N minutes on Saturday" carve-out
// without needing a second rule per domain.
const OVERRIDABLE_MODES = ["limit", "block", "restraint"];

function dayOverrideMinutes(entry, date = new Date()) {
  if (!OVERRIDABLE_MODES.includes(entry?.mode)) return null;
  const schedule = normalizeSchedule(entry.schedule);
  return schedule.dayLimits[String(date.getDay())] || null;
}

function limitMinutesForDate(entry, date = new Date()) {
  const fallback = cleanPositiveMinutes(entry?.limitMinutes) || 0;
  return dayOverrideMinutes(entry, date) || fallback;
}

function effectiveModeForDate(entry, date = new Date()) {
  const mode = entry?.mode || "unconstrained";
  return dayOverrideMinutes(entry, date) ? "limit" : mode;
}

// Restraint Mode used to let a site owner pick from five "challenge types"
// of wildly uneven difficulty (a one-click quote acknowledgement was just as
// valid as a math puzzle), which meant the actual friction of opening a
// restrained site was whatever the weakest configured type allowed. That
// defeated the point, so restraint is now a single, fixed, maximum-friction
// gate: a mandatory wait, a genuinely hard puzzle, and a written reason.
// Nothing here is user-configurable per site anymore.
const RESTRAINT_WAIT_SECONDS = 60;
const RESTRAINT_PUZZLE_STREAK_REQUIRED = 2;
const RESTRAINT_MIN_REASON_WORDS = 12;

// The bigger the escape, the bigger the cost. A one-minute peek is a short
// wait and one problem; the rest of the day, or loosening a rule for good,
// is a long wait, a long streak and a real paragraph. The 15-minute tier is
// the RESTRAINT_* baseline above.
const RESTRAINT_TIERS = [
  { upTo: 1, wait: 15, puzzles: 1, words: 0 },
  { upTo: 5, wait: 30, puzzles: 1, words: 6 },
  { upTo: 15, wait: RESTRAINT_WAIT_SECONDS, puzzles: RESTRAINT_PUZZLE_STREAK_REQUIRED, words: RESTRAINT_MIN_REASON_WORDS },
  { upTo: 60, wait: 120, puzzles: 3, words: 20 },
  { upTo: 24 * 60, wait: 300, puzzles: 4, words: 30 },
  { upTo: Infinity, wait: 600, puzzles: 5, words: 40 },
];

// minutes: how long the escape lasts; Infinity for loosening/deleting a rule.
function restraintTier(minutes) {
  return RESTRAINT_TIERS.find((t) => minutes <= t.upTo);
}

const REFLECTION_QUESTIONS = [
  "Is opening this site helping your primary goal today?",
  "What specific task or feeling are you seeking a break from right now?",
  "Will browsing this site for 10 minutes leave you feeling energized or drained?",
  "Is this visit intentional, or a reflexive habit?",
  "What would your future self wish you did right now?",
  "Are you looking for specific information, or seeking a quick distraction?",
  "Could this time be better spent taking a real break away from screens?",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Genuinely difficult, not "a few seconds" arithmetic: two-digit operands,
// occasionally three chained terms, sized to require actual scratch-work
// concentration rather than instant pattern recognition.
function generateHardPuzzle() {
  const variant = randomInt(1, 3);

  if (variant === 1) {
    // Three-term addition/subtraction chain, evaluated strictly left to
    // right (the question is written unambiguously so there's no
    // order-of-operations guessing involved).
    const nums = [randomInt(12, 89), randomInt(12, 89), randomInt(12, 89)];
    const ops = [Math.random() < 0.5 ? "+" : "-", Math.random() < 0.5 ? "+" : "-"];
    let answer = nums[0];
    let question = `${nums[0]}`;
    for (let i = 0; i < ops.length; i++) {
      question += ` ${ops[i]} ${nums[i + 1]}`;
      answer = ops[i] === "+" ? answer + nums[i + 1] : answer - nums[i + 1];
    }
    return { question: `${question} = ?`, answer };
  }

  if (variant === 2) {
    const a = randomInt(12, 89);
    const b = randomInt(4, 9);
    return { question: `${a} × ${b} = ?`, answer: a * b };
  }

  const a = randomInt(12, 29);
  const b = randomInt(11, 19);
  return { question: `${a} × ${b} = ?`, answer: a * b };
}

// Heuristic guard against low-effort "reasons" ("ok", "yes", ".", keyboard
// mashing). It can't verify truthfulness, but it can force enough real
// typed effort that reflexively clicking through stops being an option.
function validateOpenReason(text, minWords = RESTRAINT_MIN_REASON_WORDS) {
  const raw = (text || "").trim();
  if (minWords <= 0) return { valid: true, message: "" };
  if (!raw) {
    return { valid: false, message: "Explain, in your own words, why you need this right now." };
  }

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < minWords) {
    return {
      valid: false,
      message: `Write at least ${minWords} words (${words.length}/${minWords} so far).`,
    };
  }

  const wordish = words.filter((w) => /[a-zA-Z]{2,}/.test(w));
  if (wordish.length / words.length < 0.7) {
    return { valid: false, message: "That doesn't read like a real explanation. Use plain sentences." };
  }

  const vowelWords = wordish.filter((w) => /[aeiouAEIOU]/.test(w));
  if (vowelWords.length / wordish.length < 0.6) {
    return { valid: false, message: "That doesn't read like real words. Use plain sentences." };
  }

  const lowerWords = words.map((w) => w.toLowerCase());
  const uniqueRatio = new Set(lowerWords).size / lowerWords.length;
  if (uniqueRatio < 0.5) {
    return { valid: false, message: "Too repetitive to count. Write a genuine, specific reason." };
  }

  if (/(.)\1{3,}/.test(raw.replace(/\s+/g, ""))) {
    return { valid: false, message: "That looks like keyboard mashing, not an explanation." };
  }

  return { valid: true, message: "" };
}

const RESTRAINT_PASSES_KEY = "restraint_passes";
let inMemoryRestraintPasses = {};

function normalizeDomain(domain) {
  if (!domain || typeof domain !== "string") return "";
  let d = domain.trim().toLowerCase();
  if (/^https?:\/\//i.test(d)) {
    try {
      const u = new URL(d);
      d = u.hostname;
    } catch {
      d = d.replace(/^https?:\/\//i, "").split("/")[0];
    }
  } else {
    d = d.split("/")[0].split("?")[0].split("#")[0];
  }
  d = d.split(":")[0];
  d = d.replace(/^www\./i, "");
  return d;
}

async function getRestraintPasses() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const { [RESTRAINT_PASSES_KEY]: passes = {} } = await chrome.storage.local.get(RESTRAINT_PASSES_KEY);
    inMemoryRestraintPasses = passes || {};
    return passes || {};
  }
  return inMemoryRestraintPasses || {};
}

async function saveRestraintPasses(passes) {
  inMemoryRestraintPasses = passes || {};
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [RESTRAINT_PASSES_KEY]: passes });
  }
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.prototype.hasOwnProperty.call(changes, RESTRAINT_PASSES_KEY)) {
      inMemoryRestraintPasses = changes[RESTRAINT_PASSES_KEY].newValue || {};
    }
  });
}

async function grantRestraintPass(domain, durationMinutes = 15, tabId = null) {
  const cleanDomain = normalizeDomain(domain);
  if (!cleanDomain) return null;
  const passes = await getRestraintPasses();
  const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
  const passKey = tabId !== null && tabId !== undefined ? String(tabId) : cleanDomain;
  passes[passKey] = {
    tabId: tabId !== null && tabId !== undefined ? tabId : null,
    domain: cleanDomain,
    grantedAt: Date.now(),
    expiresAt,
  };
  await saveRestraintPasses(passes);
  return passes[passKey];
}

async function hasActiveRestraintPass(domain, tabId = null) {
  const cleanDomain = normalizeDomain(domain);
  if (!cleanDomain) return false;
  const passes = await getRestraintPasses();
  const now = Date.now();

  let hasExpired = false;
  for (const key of Object.keys(passes)) {
    if (passes[key] && now > passes[key].expiresAt) {
      delete passes[key];
      hasExpired = true;
    }
  }
  if (hasExpired) {
    await saveRestraintPasses(passes);
  }

  // If tabId is provided, check tab-specific pass first
  if (tabId !== null && tabId !== undefined) {
    const tabKey = String(tabId);
    const pass = passes[tabKey];
    if (pass && now <= pass.expiresAt) {
      const cleanPassDomain = normalizeDomain(pass.domain);
      if (
        cleanDomain === cleanPassDomain ||
        cleanDomain.endsWith("." + cleanPassDomain) ||
        cleanPassDomain.endsWith("." + cleanDomain)
      ) {
        return true;
      }
    }
    return false;
  }

  // Fallback if no tabId provided
  for (const key of Object.keys(passes)) {
    const pass = passes[key];
    if (pass && now <= pass.expiresAt) {
      const cleanPassDomain = normalizeDomain(pass.domain);
      if (
        cleanDomain === cleanPassDomain ||
        cleanDomain.endsWith("." + cleanPassDomain) ||
        cleanPassDomain.endsWith("." + cleanDomain)
      ) {
        return true;
      }
    }
  }

  return false;
}

async function removeRestraintPassForTab(tabId) {
  if (tabId === null || tabId === undefined) return;
  const passes = await getRestraintPasses();
  const tabKey = String(tabId);
  if (passes[tabKey]) {
    delete passes[tabKey];
    await saveRestraintPasses(passes);
  }
}

// A throwaway local date whose getDay() is exactly `day` (0=Sun…6=Sat) — Jan
// 1 2023 was a Sunday, so offsetting from it sidesteps DST/month-boundary
// edge cases entirely. Only ever fed to functions that read getDay().
function dateForDay(day) {
  return new Date(2023, 0, 1 + day);
}

// The four rule strengths, ordered. "unconstrained" is the absence of a rule.
const MODE_STRICTNESS = { unconstrained: 0, limit: 1, restraint: 2, block: 3 };

// The set of modes that actually govern a domain. Every visited domain gets an
// auto-created `unconstrained` entry, so "has an entry" is not "has a rule".
const HAS_RULE_MODES = ["limit", "restraint", "block"];

function entryHasRule(entry) {
  return !!entry && HAS_RULE_MODES.indexOf(entry.mode) !== -1;
}

// True when saving newEntry over oldEntry would reduce the friction the user
// previously set up — a weaker mode, a longer daily limit, or a narrower
// schedule. Anything that returns true must pass the friction gate first,
// wherever the edit was made. Settings is never allowed to be the cheap way
// round the blocked page, and neither is the popup.
function isLooseningRule(oldEntry, newEntry) {
  if (!oldEntry || !oldEntry.mode || oldEntry.mode === "unconstrained") return false;
  const oldRank = MODE_STRICTNESS[oldEntry.mode] ?? 0;
  const newRank = MODE_STRICTNESS[newEntry.mode] ?? 0;
  if (newRank < oldRank) return true;

  if (newRank === oldRank && oldEntry.mode === "limit") {
    if ((newEntry.limitMinutes || 0) > (oldEntry.limitMinutes || 0)) return true;
  }

  const oldSchedule = normalizeSchedule(oldEntry.schedule);
  const newSchedule = normalizeSchedule(newEntry.schedule);
  if (newSchedule.days.length < oldSchedule.days.length) return true;
  if (oldSchedule.startTime && oldSchedule.endTime && (!newSchedule.startTime || !newSchedule.endTime)) return true;

  // Per-day exceptions (dayLimits) can loosen a rule on their own — e.g.
  // carving a "10 min on Saturday" exception into an otherwise "always
  // closed" site, or simply raising an existing exception's minutes — even
  // when none of the checks above fire. Walk each weekday's effective mode
  // and minutes rather than just diffing the raw dayLimits maps, so this
  // stays correct however the two entries otherwise differ.
  for (let day = 0; day <= 6; day++) {
    const oldDayRank = MODE_STRICTNESS[effectiveModeForDate(oldEntry, dateForDay(day))] ?? 0;
    const newDayRank = MODE_STRICTNESS[effectiveModeForDate(newEntry, dateForDay(day))] ?? 0;
    if (newDayRank < oldDayRank) return true;
    if (newDayRank === oldDayRank && newDayRank === MODE_STRICTNESS.limit) {
      if (limitMinutesForDate(newEntry, dateForDay(day)) > limitMinutesForDate(oldEntry, dateForDay(day))) return true;
    }
  }

  return false;
}

// ---------- suspending a rule ----------
// A rule can be suspended for a fixed stretch (never open-ended — an
// indefinite suspension is just a deletion that hides itself). Stored as
// `paused: true` + `pausedUntil` (epoch ms). A legacy `paused: true` with no
// `pausedUntil` predates timed suspension and stays suspended until resumed.
// `suspendedOn` keeps the day keys a suspension touched, so settlement can
// exempt exactly those days instead of reading whatever state the rule is
// in when settlement happens to run.
const SUSPEND_OPTIONS = [
  { id: "15m", label: "15 minutes", minutes: 15 },
  { id: "1h", label: "1 hour", minutes: 60 },
  { id: "day", label: "Rest of today", minutes: null },
];
const MAX_SUSPENDED_DAYS = 14;

function isRuleSuspended(entry, now = Date.now()) {
  if (!entry || !entry.paused) return false;
  return !entry.pausedUntil || entry.pausedUntil > now;
}

function wasSuspendedOn(entry, dayKey) {
  if (!entry) return false;
  if (entry.paused && !entry.pausedUntil) return true; // legacy open-ended
  return Array.isArray(entry.suspendedOn) && entry.suspendedOn.includes(dayKey);
}

function suspendUntil(optionId, now = new Date()) {
  const option = SUSPEND_OPTIONS.find((o) => o.id === optionId) || SUSPEND_OPTIONS[0];
  if (option.minutes) return now.getTime() + option.minutes * 60000;
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

// Mutates entry in place.
function suspendRule(entry, optionId, now = new Date()) {
  entry.paused = true;
  entry.pausedUntil = suspendUntil(optionId, now);
  const today = dateKey(now);
  const days = (entry.suspendedOn || []).filter((d) => d !== today);
  days.push(today);
  entry.suspendedOn = days.slice(-MAX_SUSPENDED_DAYS);
  return entry;
}

// Mutates entry in place. `suspendedOn` stays: today was still suspended.
function resumeRule(entry) {
  delete entry.paused;
  delete entry.pausedUntil;
  return entry;
}

// "Suspended · back at 3:40 PM" style copy. Null when not suspended.
function suspensionLabel(entry, now = Date.now()) {
  if (!isRuleSuspended(entry, now)) return null;
  if (!entry.pausedUntil) return "Suspended until you resume it";
  const until = new Date(entry.pausedUntil);
  if (dateKey(until) !== dateKey(new Date(now)) || (until.getHours() === 0 && until.getMinutes() === 0)) {
    return "Suspended for the rest of today";
  }
  const mins = Math.ceil((entry.pausedUntil - now) / 60000);
  const time = until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Suspended · back at ${time} (${fmtMinutes(mins)})`;
}

// "Every day", "Mon–Fri · 09:00–17:00", "Sat, Sun". Plain language for a card.
function scheduleSummary(entry) {
  const schedule = normalizeSchedule(entry?.schedule);
  const days = ALL_DAYS.filter((d) => schedule.days.includes(d));
  let dayText;
  if (days.length === 7) dayText = "Every day";
  else if (days.length === 0) dayText = "No days";
  else if (days.join() === "1,2,3,4,5") dayText = "Weekdays";
  else if (days.join() === "0,6") dayText = "Weekends";
  else dayText = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_LABELS[d]).join(", ");
  const hours = schedule.startTime || schedule.endTime
    ? ` · ${schedule.startTime || "00:00"}–${schedule.endTime || "24:00"}`
    : "";
  return dayText + hours;
}

// Why a rule is or isn't in force right now, in one short phrase.
function ruleStatus(entry, date = new Date()) {
  const suspended = suspensionLabel(entry, date.getTime());
  if (suspended) return { state: "suspended", text: suspended };
  if (!isScheduleDay(entry, date)) return { state: "off", text: "Not scheduled today" };
  if (!isWithinTimeWindow(entry, date)) return { state: "off", text: "Outside its hours right now" };
  return { state: "active", text: "In force now" };
}

// Times this rule stopped the user today. `trippedToday` is reset at the
// day rollover, but rollover is lazy (next visit), so a stale counter is
// only trusted when lastReset says it belongs to `today`.
function tripsForDate(entry, key, today = todayStr()) {
  if (!entry) return 0;
  if (entry.lastReset === key) return entry.trippedToday || 0;
  const found = (entry.history || []).find((h) => h.date === key);
  return (found && found.trips) || 0;
}

function getActiveRule(entry, date = new Date()) {
  const scheduledToday = isScheduleDay(entry, date);
  const withinHours = isWithinTimeWindow(entry, date);
  return {
    active: scheduledToday && withinHours && !isRuleSuspended(entry, date.getTime()),
    scheduledToday,
    withinHours,
    limitMinutes: limitMinutesForDate(entry, date),
    mode: effectiveModeForDate(entry, date),
  };
}

function usageSecondsForDate(entry, key, today = todayStr()) {
  if (!entry) return 0;
  // An entry only rolls its counter into `history` when ensureReset() next runs
  // for that domain, which happens lazily on the next visit. Settlement reads a
  // day after it has ended, so a still-unrolled entry must be read straight off
  // usedSeconds — keying on lastReset rather than on "is this today" is both more
  // correct and identical in the common case.
  if (entry.lastReset === key) return entry.usedSeconds || 0;
  const found = (entry.history || []).find((h) => h.date === key);
  return found ? found.seconds || 0 : 0;
}

function trailingWeekUsage(entry, today = new Date()) {
  const todayKey = dateKey(today);
  const days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = addDays(today, -offset);
    const key = dateKey(date);
    days.push({
      date: key,
      label: DAY_LABELS[date.getDay()],
      seconds: usageSecondsForDate(entry, key, todayKey),
      scheduled: isScheduleDay(entry, date),
      limitMinutes: limitMinutesForDate(entry, date),
    });
  }
  return days;
}

function limitStreakDays(entry, today = new Date()) {
  if (!entry || entry.mode !== "limit") return 0;
  const createdAt = dateFromKey(entry.createdAt);
  const todayKey = dateKey(today);
  let streak = 0;

  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(today, -offset);
    if (createdAt && dateKey(date) < dateKey(createdAt)) break;
    if (!isScheduleDay(entry, date)) continue;

    const limitMinutes = limitMinutesForDate(entry, date);
    if (!limitMinutes) break;

    const usedSeconds = usageSecondsForDate(entry, dateKey(date), todayKey);
    if (usedSeconds <= limitMinutes * 60) streak++;
    else break;
  }

  return streak;
}

function getTopSitesToday(sites, today = todayStr()) {
  const list = [];
  let totalSeconds = 0;

  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    const sec = usageSecondsForDate(entry, today, today);
    if (sec > 0 || entry.mode === "limit" || entry.mode === "block") {
      totalSeconds += sec;
      list.push({
        domain,
        entry,
        seconds: sec,
        minutes: Math.round(sec / 60),
        mode: entry.mode || "unconstrained",
        paused: isRuleSuspended(entry),
      });
    }
  });

  list.sort((a, b) => b.seconds - a.seconds);

  return list.map((item) => ({
    ...item,
    pctOfTotal: totalSeconds > 0 ? Math.round((item.seconds / totalSeconds) * 100) : 0,
  }));
}

// The three categories every tracked second ultimately lands in. `label`
// is what surfaces to the user; `weight` is the single definition of how
// much each category counts toward the focus score.
const MACRO_CATEGORIES = {
  Productivity: { name: "Productivity", label: "Productive", weight: 1.0, badgeClass: "macro-productivity" },
  General: { name: "General", label: "General Browsing", weight: 0.6, badgeClass: "macro-general" },
  Leisure: { name: "Leisure", label: "Leisure", weight: 0.1, badgeClass: "macro-leisure" },
};

const MACRO_ORDER = ["Productivity", "General", "Leisure"];

// Where a classification lands when only the macro category is known.
const DEFAULT_MICRO_FOR_MACRO = {
  Productivity: "Study",
  General: "General Browsing",
  Leisure: "Streaming",
};

const MICRO_CATEGORIES = {
  // Productivity
  "Study": { name: "Study", macro: "Productivity" },
  "Coding": { name: "Coding", macro: "Productivity" },
  "AI & Chatbots": { name: "AI & Chatbots", macro: "Productivity" },
  "Documentation": { name: "Documentation", macro: "Productivity" },
  "Workplace & Ops": { name: "Workplace & Ops", macro: "Productivity" },
  "Research & Reference": { name: "Research & Reference", macro: "Productivity" },

  // General
  "Email": { name: "Email", macro: "General" },
  "Shopping": { name: "Shopping", macro: "General" },
  "Banking & Finance": { name: "Banking & Finance", macro: "General" },
  "News": { name: "News", macro: "General" },
  "Search & Utilities": { name: "Search & Utilities", macro: "General" },
  "General Browsing": { name: "General Browsing", macro: "General" },

  // Leisure
  "Social Media": { name: "Social Media", macro: "Leisure" },
  "Streaming": { name: "Streaming", macro: "Leisure" },
  "Gaming": { name: "Gaming", macro: "Leisure" },
  "Entertainment": { name: "Entertainment", macro: "Leisure" },
  "Forums & Community": { name: "Forums & Community", macro: "Leisure" },
  "Messaging": { name: "Messaging", macro: "Leisure" },

  // System bucket. Not user-selectable — it is what a prediction resolves
  // to when it was not confident enough to commit to a real category, and
  // it exists here so it always maps to a valid macro rather than falling
  // through MICRO_TO_MACRO as undefined.
  "Unclassified": { name: "Unclassified", macro: "General", system: true },
};

const MICRO_TO_MACRO = Object.keys(MICRO_CATEGORIES).reduce((acc, micro) => {
  acc[micro] = MICRO_CATEGORIES[micro].macro;
  return acc;
}, {});

// The micro categories a user can pick, grouped by macro. Derived from the
// taxonomy above so the pickers in the options page can never drift out of
// sync with it.
function selectableMicrosByMacro() {
  const groups = {};
  MACRO_ORDER.forEach((macro) => {
    groups[macro] = [];
  });
  Object.keys(MICRO_CATEGORIES).forEach((micro) => {
    const def = MICRO_CATEGORIES[micro];
    if (def.system) return;
    if (!groups[def.macro]) groups[def.macro] = [];
    groups[def.macro].push(micro);
  });
  return groups;
}

// ---------- Content-Aware Classification Architecture ----------

class ClassificationContext {
  constructor({
    domain = "",
    url = "",
    title = "",
    channelId = null,
    channelName = null,
    videoId = null,
    contentType = null,
    aiResult = null,
    metadata = {},
  } = {}) {
    this.url = url || "";
    this.domain = ClassificationContext.normalizeDomain(
      domain || (this.url ? ClassificationContext.extractDomainFromUrl(this.url) : "")
    );
    this.title = title || "";
    this.channelId = channelId;
    this.channelName = channelName;
    this.videoId = videoId;
    this.contentType = contentType;
    this.aiResult = aiResult;
    this.metadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
  }

  static extractDomainFromUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      let u = String(rawUrl).trim();
      if (!/^https?:\/\//i.test(u)) u = "https://" + u;
      const parsed = new URL(u);
      return parsed.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  }

  static normalizeDomain(domain) {
    if (!domain) return "";
    return String(domain)
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }

  static create(input, extra = {}) {
    if (input instanceof ClassificationContext) {
      if (Object.keys(extra).length === 0) return input;
      return new ClassificationContext({ ...input.toObject(), ...extra });
    }
    if (typeof input === "string") {
      const isUrl = /^https?:\/\/|\//.test(input) || input.includes("?");
      if (isUrl) {
        return new ClassificationContext({ url: input, ...extra });
      } else {
        return new ClassificationContext({ domain: input, ...extra });
      }
    }
    if (typeof input === "object" && input !== null) {
      return new ClassificationContext({ ...input, ...extra });
    }
    return new ClassificationContext(extra);
  }

  toObject() {
    return {
      domain: this.domain,
      url: this.url,
      title: this.title,
      channelId: this.channelId,
      channelName: this.channelName,
      videoId: this.videoId,
      contentType: this.contentType,
      aiResult: this.aiResult ? { ...this.aiResult } : null,
      metadata: { ...this.metadata },
    };
  }
}

class ClassificationResult {
  constructor({
    macro = "General",
    micro = "General Browsing",
    confidence = 1.0,
    source = "default",
    metadata = {},
  } = {}) {
    this.macro = macro;
    this.micro = micro;
    this.confidence = confidence;
    this.source = source;
    this.metadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
  }

  toObject() {
    return {
      macro: this.macro,
      micro: this.micro,
      confidence: this.confidence,
      source: this.source,
      metadata: { ...this.metadata },
    };
  }
}

// Extractor Provider/Adapter Architecture
class ContentExtractorAdapter {
  constructor(name = "base") {
    this.name = name;
  }

  canHandle(domain, url) {
    return false;
  }

  extract(inputContext) {
    return inputContext;
  }
}

class GenericDomainExtractorAdapter extends ContentExtractorAdapter {
  constructor() {
    super("generic_domain");
  }

  canHandle(domain, url) {
    return true;
  }

  extract(inputContext) {
    const ctx = ClassificationContext.create(inputContext);
    if (!ctx.domain && ctx.url) {
      ctx.domain = ClassificationContext.extractDomainFromUrl(ctx.url);
    }
    return ctx;
  }
}

class YouTubeExtractorAdapter extends ContentExtractorAdapter {
  constructor() {
    super("youtube");
  }

  canHandle(domain, url) {
    const d = ClassificationContext.normalizeDomain(domain || (url ? ClassificationContext.extractDomainFromUrl(url) : ""));
    return d === "youtube.com" || d.endsWith(".youtube.com") || d === "youtu.be";
  }

  extract(inputContext) {
    const ctx = ClassificationContext.create(inputContext);
    ctx.contentType = ctx.contentType || "video";
    const rawUrl = ctx.url;

    if (rawUrl) {
      try {
        let u = rawUrl.trim();
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        const parsed = new URL(u);

        // Extract Video ID
        if (parsed.hostname.includes("youtu.be")) {
          const videoId = parsed.pathname.slice(1).split("/")[0];
          if (videoId) ctx.videoId = ctx.videoId || videoId;
        } else if (parsed.pathname === "/watch") {
          const videoId = parsed.searchParams.get("v");
          if (videoId) ctx.videoId = ctx.videoId || videoId;
        } else if (parsed.pathname.startsWith("/embed/")) {
          const videoId = parsed.pathname.split("/embed/")[1]?.split("?")[0];
          if (videoId) ctx.videoId = ctx.videoId || videoId;
        } else if (parsed.pathname.startsWith("/shorts/")) {
          const videoId = parsed.pathname.split("/shorts/")[1]?.split("?")[0];
          if (videoId) ctx.videoId = ctx.videoId || videoId;
          ctx.contentType = "short";
        }

        // Extract Channel
        if (parsed.pathname.startsWith("/@")) {
          ctx.channelName = ctx.channelName || parsed.pathname.slice(2).split("/")[0];
        } else if (parsed.pathname.startsWith("/c/") || parsed.pathname.startsWith("/channel/") || parsed.pathname.startsWith("/user/")) {
          const parts = parsed.pathname.split("/").filter(Boolean);
          if (parts.length >= 2) {
            if (parts[0] === "channel") {
              ctx.channelId = ctx.channelId || parts[1];
            } else {
              ctx.channelName = ctx.channelName || parts[1];
            }
          }
        }

        const abChannel = parsed.searchParams.get("ab_channel");
        if (abChannel && !ctx.channelName) {
          ctx.channelName = abChannel;
        }
      } catch {
        /* Ignore URL parse errors */
      }
    }

    return ctx;
  }
}

class ChatGPTExtractorAdapter extends ContentExtractorAdapter {
  constructor() {
    super("chatgpt");
  }

  canHandle(domain, url) {
    const d = ClassificationContext.normalizeDomain(domain || (url ? ClassificationContext.extractDomainFromUrl(url) : ""));
    return d === "chatgpt.com" || d.endsWith(".chatgpt.com") || d === "openai.com" || d.endsWith(".openai.com");
  }

  extract(inputContext) {
    const ctx = ClassificationContext.create(inputContext);
    ctx.contentType = ctx.contentType || "chat";

    if (ctx.url) {
      try {
        let u = ctx.url.trim();
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        const parsed = new URL(u);

        if (parsed.pathname.startsWith("/c/")) {
          const chatId = parsed.pathname.split("/c/")[1]?.split("/")[0];
          if (chatId) ctx.metadata.chatId = chatId;
        } else if (parsed.pathname.startsWith("/g/")) {
          const gptId = parsed.pathname.split("/g/")[1]?.split("/")[0];
          if (gptId) ctx.metadata.customGptId = gptId;
        }
      } catch {
        /* Ignore */
      }
    }

    return ctx;
  }
}

class RedditExtractorAdapter extends ContentExtractorAdapter {
  constructor() {
    super("reddit");
  }

  canHandle(domain, url) {
    const d = ClassificationContext.normalizeDomain(domain || (url ? ClassificationContext.extractDomainFromUrl(url) : ""));
    return d === "reddit.com" || d.endsWith(".reddit.com");
  }

  extract(inputContext) {
    const ctx = ClassificationContext.create(inputContext);
    ctx.contentType = ctx.contentType || "post";

    if (ctx.url) {
      try {
        let u = ctx.url.trim();
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        const parsed = new URL(u);

        if (parsed.pathname.startsWith("/r/")) {
          const parts = parsed.pathname.split("/r/")[1]?.split("/").filter(Boolean);
          if (parts && parts.length > 0) {
            ctx.metadata.subreddit = parts[0];
            if (parts.length > 1 && parts[1] === "comments") {
              ctx.metadata.postId = parts[2] || null;
            }
          }
        }
      } catch {
        /* Ignore */
      }
    }

    return ctx;
  }
}

class ExtractorRegistry {
  constructor() {
    this.adapters = [];
    this.fallbackAdapter = new GenericDomainExtractorAdapter();
  }

  register(adapter) {
    if (adapter && typeof adapter.canHandle === "function" && typeof adapter.extract === "function") {
      this.adapters.unshift(adapter);
    }
  }

  getAdapter(domain, url) {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(domain, url)) {
        return adapter;
      }
    }
    return this.fallbackAdapter;
  }

  extract(input, extra = {}) {
    const initialContext = ClassificationContext.create(input, extra);
    const adapter = this.getAdapter(initialContext.domain, initialContext.url);
    return adapter.extract(initialContext);
  }
}

// Classifier Rules & Pipeline Architecture
class ClassifierRule {
  constructor(name = "rule") {
    this.name = name;
  }

  classify(context, sites = null) {
    return null;
  }
}

class UserOverrideClassifierRule extends ClassifierRule {
  constructor() {
    super("user_override");
  }

  classify(context, sites = null) {
    if (!sites || !context) return null;

    const d = context.domain;
    const entry = (d ? sites[d] : null) || (context.url ? sites[context.url] : null);
    if (!entry) return null;

    let customMicro = entry.microCategory || entry.category || null;
    let customMacro = entry.macroCategory || null;

    const LEGACY_MAP = {
      "Productivity & Tech": "Workplace & Ops",
      "Video & Media": "Streaming",
      "News & Info": "News",
    };
    if (customMicro && LEGACY_MAP[customMicro]) {
      customMicro = LEGACY_MAP[customMicro];
    }

    if (!customMicro && !customMacro) return null;

    const micro = customMicro || "General Browsing";
    const macro = customMacro || MICRO_TO_MACRO[micro] || "General";

    return new ClassificationResult({
      macro,
      micro,
      confidence: 1.0,
      source: "user_override",
    });
  }
}

class ContentExtractorClassifierRule extends ClassifierRule {
  constructor() {
    super("content_extractor");
  }

  classify(context, sites = null) {
    if (!context) return null;

    if (context.aiResult && context.aiResult.micro) {
      const micro = context.aiResult.micro;
      const macro = context.aiResult.macro || MICRO_TO_MACRO[micro] || "General";
      const confidence = Number(context.aiResult.confidence) || 0.9;
      return new ClassificationResult({
        macro,
        micro,
        confidence,
        source: "ai_assisted",
        metadata: context.aiResult.metadata || {},
      });
    }

    if (context.metadata && context.metadata.category) {
      const micro = context.metadata.category;
      const macro = context.metadata.macroCategory || MICRO_TO_MACRO[micro] || "General";
      return new ClassificationResult({
        macro,
        micro,
        confidence: 0.85,
        source: "content_extractor",
        metadata: context.metadata,
      });
    }

    return null;
  }
}

class DomainRuleClassifierRule extends ClassifierRule {
  constructor() {
    super("domain_rule");
  }

  classify(context, sites = null) {
    if (!context || !context.domain) return null;
    const d = context.domain;

    let micro = null;

    // Productivity
    if (/physicswallah|pw\.live|coursera|udemy|duolingo|khanacademy|edx|canvas|blackboard|quizlet|brainly/i.test(d)) {
      micro = "Study";
    } else if (/github|gitlab|stackoverflow|leetcode|hackerrank|codeforces|npmjs|npm|developer|replit|codesandbox|codepen/i.test(d)) {
      micro = "Coding";
    } else if (/chatgpt|claude|openai|anthropic|gemini|perplex|poe\.com/i.test(d)) {
      micro = "AI & Chatbots";
    } else if (/developer\.mozilla|devdocs|docs\.|mdn|w3schools|man7|readthedocs/i.test(d)) {
      micro = "Documentation";
    } else if (/notion|figma|slack|jira|linear|trello|asana|miro|dropbox|google\.com\/docs|docs\.google|sheets\.google|slides\.google|office\.com/i.test(d)) {
      micro = "Workplace & Ops";
    } else if (/wikipedia|arxiv|scholar\.google|researchgate|jstor|sciencedirect/i.test(d)) {
      micro = "Research & Reference";
    }
    // Leisure
    else if (/instagram|twitter|x\.com|reddit|linkedin|threads|snapchat|facebook|tiktok/i.test(d)) {
      micro = "Social Media";
    } else if (/youtube|netflix|twitch|spotify|hulu|disney|primevideo|vimeo|soundcloud|hbo/i.test(d)) {
      micro = "Streaming";
    } else if (/steam|roblox|chess\.com|epicgames|ign|playstation|xbox|itch\.io/i.test(d)) {
      micro = "Gaming";
    } else if (/9gag|buzzfeed|imdb|rotten|tmz|giphy/i.test(d)) {
      micro = "Entertainment";
    } else if (/ycombinator|quora|disqus|forum|stackexchange/i.test(d)) {
      micro = "Forums & Community";
    } else if (/discord|whatsapp|telegram|messenger|web\.whatsapp/i.test(d)) {
      micro = "Messaging";
    }
    // General
    else if (/mail\.google|gmail|outlook|proton\.me|protonmail|yahoo\.com\/mail/i.test(d)) {
      micro = "Email";
    } else if (/amazon|ebay|etsy|walmart|aliexpress|target|bestbuy/i.test(d)) {
      micro = "Shopping";
    } else if (/paypal|stripe|chase|bankofamerica|fidelity|vanguard|revolut|wells/i.test(d)) {
      micro = "Banking & Finance";
    } else if (/nytimes|bbc|cnn|reuters|apnews|theguardian|bloomberg|wsj|washingtonpost/i.test(d)) {
      micro = "News";
    } else if (/google|duckduckgo|bing|maps\.google|translate/i.test(d)) {
      micro = "Search & Utilities";
    }

    if (micro) {
      const macro = MICRO_TO_MACRO[micro] || "General";
      return new ClassificationResult({
        macro,
        micro,
        confidence: 0.8,
        source: "domain_rule",
      });
    }

    return null;
  }
}

class FallbackClassifierRule extends ClassifierRule {
  constructor() {
    super("fallback");
  }

  classify(context, sites = null) {
    return new ClassificationResult({
      macro: "General",
      micro: "General Browsing",
      confidence: 0.5,
      source: "fallback",
    });
  }
}

// Ordered chain of rules; the first one to return a result wins.
//
// Rules carry an explicit priority (lower runs earlier) so a platform
// module loaded later — youtube-classifier.js registers itself at priority
// 10 — can slot itself into the right place in the chain instead of the
// order depending on which file happened to load first. Rules added
// without a priority keep plain insertion order among their peers.
const RULE_PRIORITY = {
  PLATFORM_EXPLICIT: 10,
  USER_OVERRIDE: 20,
  CONTENT_EXTRACTOR: 30,
  PLATFORM_PREDICTION: 40,
  DOMAIN_RULE: 50,
  FALLBACK: 90,
};

class ClassificationPipeline {
  constructor() {
    this.rules = [];
  }

  addRule(rule, priority = RULE_PRIORITY.DOMAIN_RULE) {
    if (!rule || typeof rule.classify !== "function") return;
    const entry = { rule, priority };
    // Insert after every rule of equal-or-lower priority, which keeps
    // insertion order stable within a priority band.
    let index = this.rules.length;
    for (let i = 0; i < this.rules.length; i++) {
      if (this.rules[i].priority > priority) {
        index = i;
        break;
      }
    }
    this.rules.splice(index, 0, entry);
  }

  get orderedRules() {
    return this.rules.map((r) => r.rule);
  }

  classify(context, sites = null) {
    const ctx = ClassificationContext.create(context);
    for (const { rule } of this.rules) {
      const result = rule.classify(ctx, sites);
      if (result) {
        return result;
      }
    }
    return new ClassificationResult({
      macro: "General",
      micro: "General Browsing",
      confidence: 0.5,
      source: "fallback",
    });
  }
}

// ---------- classification epoch ----------
// Bumped whenever anything a classification could depend on changes: the
// user's per-site categories, the YouTube channel database, the per-video
// overrides. Cache keys embed the current epoch, so a single bump retires
// every cached answer at once.
//
// This replaces hashing the entire `sites` map into every cache key, which
// was both expensive (a full JSON.stringify per lookup, and analytics does
// one lookup per tracked domain per render) and self-defeating: usedSeconds
// changes on every tick, so the key changed constantly and the cache
// effectively never hit.
let classificationEpoch = 0;

function invalidateClassificationCache() {
  classificationEpoch++;
  if (typeof defaultClassificationCache !== "undefined" && defaultClassificationCache) {
    defaultClassificationCache.clear();
  }
}

function getClassificationEpoch() {
  return classificationEpoch;
}

// Caching Layer
class ClassificationCache {
  constructor(maxSize = 500, ttlMs = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  // The key is the classification *identity* of the request — the fields any
  // rule can actually branch on — plus the epoch.
  makeKey(context, sites = null) {
    const ctx = ClassificationContext.create(context);
    const identity = [
      ctx.url || "",
      ctx.domain || "",
      ctx.videoId || "",
      ctx.channelId || "",
      ctx.channelName || "",
      ctx.title || "",
      sites ? "sites" : "no_sites",
    ].join("::");
    return `e${classificationEpoch}::${identity}`;
  }

  get(context, sites = null) {
    const key = this.makeKey(context, sites);
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.result;
  }

  set(context, sites = null, result, ttlMs = this.ttlMs) {
    const key = this.makeKey(context, sites);
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear() {
    this.cache.clear();
  }
}


// Singletons & Core API Entry Points
const defaultExtractorRegistry = new ExtractorRegistry();
defaultExtractorRegistry.register(new YouTubeExtractorAdapter());
defaultExtractorRegistry.register(new ChatGPTExtractorAdapter());
defaultExtractorRegistry.register(new RedditExtractorAdapter());

const defaultClassificationPipeline = new ClassificationPipeline();
defaultClassificationPipeline.addRule(new UserOverrideClassifierRule(), RULE_PRIORITY.USER_OVERRIDE);
defaultClassificationPipeline.addRule(new ContentExtractorClassifierRule(), RULE_PRIORITY.CONTENT_EXTRACTOR);
defaultClassificationPipeline.addRule(new DomainRuleClassifierRule(), RULE_PRIORITY.DOMAIN_RULE);
defaultClassificationPipeline.addRule(new FallbackClassifierRule(), RULE_PRIORITY.FALLBACK);

// Platform modules (youtube-classifier.js) call this on load to slot their
// own rules into the default pipeline at the right priority. Keeping the
// registration one-directional is what lets common.js stay unaware of
// YouTube while still classifying it correctly.
function registerClassifierRule(rule, priority = RULE_PRIORITY.DOMAIN_RULE) {
  defaultClassificationPipeline.addRule(rule, priority);
  invalidateClassificationCache();
}

// ---------- content services ----------
// A content service knows how to split one site's tracked time across
// several categories — YouTube time belongs to the channels and videos
// that were actually watched, not to "youtube.com". Analytics asks the
// registry; it never asks about YouTube directly.
//
// Interface:
//   name           string
//   handlesDomain(domain) -> boolean
//   resolveSegments(domain, entry, dayKey, totalSeconds, sites)
//                  -> [{ macro, micro, seconds, sources }] | null
const contentServices = [];

function registerContentService(service) {
  if (
    service &&
    typeof service.handlesDomain === "function" &&
    typeof service.resolveSegments === "function"
  ) {
    contentServices.push(service);
    invalidateClassificationCache();
  }
}

function getContentServices() {
  return contentServices.slice();
}

const defaultClassificationCache = new ClassificationCache();

function classifyContext(input, sites = null, options = {}) {
  const useCache = options.useCache !== false;

  if (useCache) {
    const cached = defaultClassificationCache.get(input, sites);
    if (cached) return cached;
  }

  const context = defaultExtractorRegistry.extract(input, options.extraContext || {});
  const result = defaultClassificationPipeline.classify(context, sites);

  if (useCache) {
    defaultClassificationCache.set(input, sites, result);
  }

  return result;
}

// Retained for callers that want to be sure the platform stores behind the
// pipeline are loaded before classifying (the service worker's debug
// handler). Classification itself is synchronous — platform modules keep
// in-memory snapshots — so this only primes them.
async function classifyContextAsync(input, sites = null, options = {}) {
  for (const service of contentServices) {
    if (typeof service.prime === "function") {
      try {
        await service.prime();
      } catch {
        /* a platform that can't prime still classifies off its last snapshot */
      }
    }
  }
  return classifyContext(input, sites, options);
}

function getDomainTaxonomy(domainOrInput, sites = null) {
  if (!domainOrInput) return { macro: "General", micro: "General Browsing" };

  const result = classifyContext(domainOrInput, sites);
  return { macro: result.macro, micro: result.micro };
}


function getDomainCategory(domain, sites = null) {
  const { micro } = getDomainTaxonomy(domain, sites);
  return micro;
}

// Single definition of how much a category counts toward the focus score —
// read straight off MACRO_CATEGORIES so the weights can't drift.
function getCategoryFocusWeight(category) {
  const cat = typeof category === "object" ? category.macro : category;
  const def = MACRO_CATEGORIES[cat];
  return def ? def.weight : MACRO_CATEGORIES.General.weight;
}

// ---------- category segmentation ----------
// The one place that answers "how does this site's time for this day break
// down by category?". A plain site is a single segment carrying its whole
// day; a site owned by a content service (YouTube) is split across the
// content that was actually consumed on it.
//
// Every analytics function goes through here, so a channel re-classification
// or a manual override lands identically in the focus score, the category
// breakdown, and the audit table — there is no second code path to update.
function entryCategorySegments(domain, entry, dayKey, sites, totalSeconds) {
  const seconds =
    totalSeconds !== undefined ? totalSeconds : usageSecondsForDate(entry, dayKey, dayKey);
  if (!(seconds > 0)) return [];

  for (const service of contentServices) {
    if (!service.handlesDomain(domain)) continue;
    let segments = null;
    try {
      segments = service.resolveSegments(domain, entry, dayKey, seconds, sites);
    } catch (err) {
      console.error(`[Stoic] content service "${service.name}" failed to segment ${domain}`, err);
    }
    if (segments && segments.length) return segments;
  }

  const { macro, micro } = getDomainTaxonomy(domain, sites);
  return [{ macro, micro, seconds, sources: ["domain_rule"] }];
}

// Focus Score = Productive% - (Leisure% × 0.25).
//
// Productive time earns a point for every percentage point; General is
// neutral (choosing it over Productive already costs you those points, so
// it isn't docked again); Leisure is active distraction and applies a
// small additional penalty on top of that natural opportunity cost. The
// result is something a user can roughly estimate just from their
// browsing distribution, without needing to know internal weights.
function calculateFocusScore(sites, today = todayStr()) {
  let totalSeconds = 0;
  let productiveSeconds = 0;
  let leisureSeconds = 0;

  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    const sec = usageSecondsForDate(entry, today, today);
    if (sec <= 0) return;

    totalSeconds += sec;

    // Segment each site by category on its own merits. An hour of YouTube
    // is not one flat category — the part spent on a channel classified
    // as productive counts as productive, etc.
    entryCategorySegments(domain, entry, today, sites, sec).forEach((segment) => {
      if (segment.macro === "Productivity") {
        productiveSeconds += segment.seconds;
      } else if (segment.macro === "Leisure") {
        leisureSeconds += segment.seconds;
      }
    });
  });

  if (totalSeconds === 0) return 100;

  const productivePct = (productiveSeconds / totalSeconds) * 100;
  const leisurePct = (leisureSeconds / totalSeconds) * 100;
  const rawScore = productivePct - leisurePct * 0.25;

  return Math.min(100, Math.max(0, Math.round(rawScore)));
}

function generateQuickInsight(sites, today = todayStr()) {
  const topSites = getTopSitesToday(sites, today);
  const totalSeconds = topSites.reduce((acc, s) => acc + s.seconds, 0);

  if (totalSeconds === 0) {
    return "Your browsing analytics are active. Visit websites to view real-time session tracking.";
  }

  const breakdown = getCategoryBreakdown(sites, today);
  const topMacro = breakdown.macroBreakdown.length > 0 ? breakdown.macroBreakdown[0] : null;
  const topSite = topSites.length > 0 ? topSites[0] : null;
  const moderation = getModerationStats(sites, today);

  // 1. Dominant site insight if >= 40% of time
  if (topSite && topSite.pctOfTotal >= 40) {
    const timeStr = fmtDuration(topSite.seconds);
    return `${topSite.domain} is your #1 site today (${timeStr}, ${topSite.pctOfTotal}% of active browsing).`;
  }

  // 2. Category concentration insight if dominant macro category >= 35%
  if (topMacro && topMacro.pctOfTotal >= 35) {
    const topMicroNames = topMacro.micros.slice(0, 2).map((m) => m.micro).join(" & ");
    return `${topMacro.macro} accounted for ${topMacro.pctOfTotal}% of today's browsing time (${fmtDuration(topMacro.seconds)}${topMicroNames ? ` — top: ${topMicroNames}` : ""}).`;
  }

  // 3. Behavioral moderation insight if limits triggered
  if (moderation.limitsTriggeredToday > 0) {
    return `Your rules stopped you ${moderation.limitsTriggeredToday} time${moderation.limitsTriggeredToday > 1 ? "s" : ""} today.`;
  }

  if (moderation.limitedSitesCount > 0 && moderation.limitsTriggeredToday === 0) {
    return `No rule has had to stop you yet today.`;
  }

  const totalMinStr = fmtDuration(totalSeconds);
  return `Tracked ${totalMinStr} across ${topSites.length} website${topSites.length > 1 ? 's' : ''} today.`;
}

function getCategoryBreakdown(sites, today = todayStr()) {
  const macros = {
    Productivity: { name: "Productivity", seconds: 0, micros: {} },
    General: { name: "General", seconds: 0, micros: {} },
    Leisure: { name: "Leisure", seconds: 0, micros: {} },
  };
  let totalSeconds = 0;

  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    const sec = usageSecondsForDate(entry, today, today);
    if (sec > 0) {
      totalSeconds += sec;
      entryCategorySegments(domain, entry, today, sites, sec).forEach((segment) => {
        const { macro, micro, seconds } = segment;
        if (!macros[macro]) {
          macros[macro] = { name: macro, seconds: 0, micros: {} };
        }
        macros[macro].seconds += seconds;
        macros[macro].micros[micro] = (macros[macro].micros[micro] || 0) + seconds;
      });
    }
  });

  const macroList = Object.keys(macros).map((mac) => {
    const mData = macros[mac];
    const microList = Object.keys(mData.micros).map((mic) => ({
      micro: mic,
      macro: mac,
      seconds: Math.round(mData.micros[mic]),
      minutes: Math.round(mData.micros[mic] / 60),
      pctOfMacro: mData.seconds > 0 ? Math.round((mData.micros[mic] / mData.seconds) * 100) : 0,
      pctOfTotal: totalSeconds > 0 ? Math.round((mData.micros[mic] / totalSeconds) * 100) : 0,
    })).sort((a, b) => b.seconds - a.seconds);

    return {
      macro: mac,
      seconds: Math.round(mData.seconds),
      minutes: Math.round(mData.seconds / 60),
      pctOfTotal: totalSeconds > 0 ? Math.round((mData.seconds / totalSeconds) * 100) : 0,
      micros: microList,
    };
  }).filter((m) => m.seconds > 0 || totalSeconds === 0).sort((a, b) => b.seconds - a.seconds);

  const microList = macroList.flatMap((m) => m.micros).sort((a, b) => b.seconds - a.seconds);

  return {
    totalSeconds,
    macroBreakdown: macroList,
    microBreakdown: microList,
    // Flat category list for legacy callers
    categoryList: microList.map((m) => ({
      category: `${m.macro} · ${m.micro}`,
      macro: m.macro,
      micro: m.micro,
      seconds: m.seconds,
      minutes: m.minutes,
      pctOfTotal: m.pctOfTotal,
    })),
  };
}

function getBrowsingStats(sites, today = todayStr()) {
  const allSitesList = [];
  let totalSeconds = 0;

  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    const sec = usageSecondsForDate(entry, today, today);
    if (sec > 0) {
      totalSeconds += sec;
      const taxonomy = getDomainTaxonomy(domain, sites);
      // For a segmented site the headline taxonomy is whichever category
      // actually took the most time, not the generic domain rule — showing
      // "Leisure · Streaming" against a day of lecture-watching was the
      // most visible symptom of classification never reaching analytics.
      const segments = entryCategorySegments(domain, entry, today, sites, sec);
      const dominant = segments.length > 0 ? segments[0] : null;
      const effective =
        segments.length > 0
          ? { macro: dominant.macro, micro: dominant.micro }
          : taxonomy;

      allSitesList.push({
        domain,
        entry,
        seconds: sec,
        minutes: Math.round(sec / 60),
        mode: entry.mode || "unconstrained",
        paused: isRuleSuspended(entry),
        taxonomy: effective,
        domainTaxonomy: taxonomy,
        segments,
        segmented: segments.length > 1,
        category: effective.micro,
        macroCategory: effective.macro,
      });
    }
  });

  allSitesList.sort((a, b) => b.seconds - a.seconds);

  const topWebsites = allSitesList.map((item) => ({
    ...item,
    pctOfTotal: totalSeconds > 0 ? Math.round((item.seconds / totalSeconds) * 100) : 0,
  }));

  return {
    totalSeconds,
    totalMinutes: Math.round(totalSeconds / 60),
    uniqueVisitedCount: allSitesList.length,
    topWebsites,
    categoryBreakdown: getCategoryBreakdown(sites, today),
  };
}

function getDailyComparison(sites, todayKey = todayStr()) {
  const browsingToday = getBrowsingStats(sites, todayKey);
  const todaySec = browsingToday.totalSeconds;

  const todayDate = dateFromKey(todayKey) || new Date();
  const yesterdayDate = addDays(todayDate, -1);
  const yesterdayKey = dateKey(yesterdayDate);

  let yesterdaySec = 0;
  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    yesterdaySec += usageSecondsForDate(entry, yesterdayKey, todayKey);
  });

  if (yesterdaySec > 0) {
    const diffSec = todaySec - yesterdaySec;
    const pct = Math.abs(Math.round((diffSec / yesterdaySec) * 100));

    if (diffSec < -30) {
      return {
        text: `↓ ${pct}% vs yesterday`,
        type: "positive",
        diffSec,
      };
    } else if (diffSec > 30) {
      return {
        text: `↑ ${pct}% vs yesterday`,
        type: "negative",
        diffSec,
      };
    } else {
      return {
        text: `~ Same as yesterday`,
        type: "neutral",
        diffSec: 0,
      };
    }
  }

  // Fallback to 7-day average if yesterday has no recorded usage
  let weekTotalSec = 0;
  let activeDaysCount = 0;
  for (let i = 1; i <= 7; i++) {
    const dKey = dateKey(addDays(todayDate, -i));
    let daySec = 0;
    Object.keys(sites || {}).forEach((domain) => {
      daySec += usageSecondsForDate(sites[domain], dKey, todayKey);
    });
    if (daySec > 0) {
      weekTotalSec += daySec;
      activeDaysCount++;
    }
  }

  if (activeDaysCount > 0) {
    const avgSec = Math.round(weekTotalSec / activeDaysCount);
    const diffSec = todaySec - avgSec;
    const pct = Math.abs(Math.round((diffSec / avgSec) * 100));

    if (diffSec < -30) {
      return {
        text: `↓ ${pct}% vs avg`,
        type: "positive",
        diffSec,
      };
    } else if (diffSec > 30) {
      return {
        text: `↑ ${pct}% vs avg`,
        type: "negative",
        diffSec,
      };
    } else {
      return {
        text: `~ Same as avg`,
        type: "neutral",
        diffSec: 0,
      };
    }
  }

  return {
    text: `First day of tracking`,
    type: "neutral",
    diffSec: 0,
  };
}

function getFocusScoreTheme(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  // Colours resolve through the theme, so the same score reads correctly in
  // Limestone and Basalt. Labels describe the day; they do not grade it.
  if (s <= 20) {
    return { label: "Mostly leisure", color: "var(--missed)", class: "score-very-low" };
  } else if (s <= 40) {
    return { label: "Mostly leisure", color: "var(--missed)", class: "score-low" };
  } else if (s <= 60) {
    return { label: "Mixed", color: "var(--partial)", class: "score-medium" };
  } else if (s <= 80) {
    return { label: "Mostly productive", color: "var(--held)", class: "score-good" };
  } else {
    return { label: "Almost all productive", color: "var(--held)", class: "score-excellent" };
  }
}

function getModerationStats(sites, today = todayStr()) {
  let limitedSitesCount = 0;
  let limitsTriggeredToday = 0;
  let totalTimesTripped = 0;
  let suspendedCount = 0;
  const activeRulesList = [];

  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    if (!entryHasRule(entry)) return;
    limitedSitesCount++;
    const tripped = entry.timesTripped || 0;
    const trippedToday = tripsForDate(entry, today, today);
    const paused = isRuleSuspended(entry);
    totalTimesTripped += tripped;
    limitsTriggeredToday += trippedToday;
    if (paused) suspendedCount++;

    activeRulesList.push({
      domain,
      entry,
      mode: entry.mode,
      limitMinutes: entry.limitMinutes || 0,
      usedSeconds: usageSecondsForDate(entry, today, today),
      timesTripped: tripped,
      trippedToday,
      paused,
    });
  });

  return {
    limitedSitesCount,
    limitsTriggeredToday,
    totalTimesTripped,
    suspendedCount,
    activeRulesList,
  };
}

function getDomainDisplayName(domain) {
  if (!domain) return "";
  const d = String(domain).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  const knownMap = {
    "youtube.com": "YouTube",
    "github.com": "GitHub",
    "chatgpt.com": "ChatGPT",
    "openai.com": "ChatGPT",
    "twitter.com": "X",
    "x.com": "X",
    "instagram.com": "Instagram",
    "reddit.com": "Reddit",
    "facebook.com": "Facebook",
    "linkedin.com": "LinkedIn",
    "netflix.com": "Netflix",
    "twitch.tv": "Twitch",
    "spotify.com": "Spotify",
    "amazon.com": "Amazon",
    "google.com": "Google",
    "gitlab.com": "GitLab",
    "stackoverflow.com": "Stack Overflow",
    "notion.so": "Notion",
    "figma.com": "Figma",
    "slack.com": "Slack",
    "jira.atlassian.com": "Jira",
    "medium.com": "Medium",
    "substack.com": "Substack",
    "tiktok.com": "TikTok",
    "wikipedia.org": "Wikipedia",
    "physicswallah.com": "PhysicsWallah",
    "pw.live": "PhysicsWallah",
  };

  if (knownMap[d]) return knownMap[d];

  const brandKeywords = [
    { key: "physicswallah", name: "PhysicsWallah" },
    { key: "youtube", name: "YouTube" },
    { key: "github", name: "GitHub" },
    { key: "chatgpt", name: "ChatGPT" },
    { key: "openai", name: "ChatGPT" },
    { key: "twitter", name: "X" },
    { key: "instagram", name: "Instagram" },
    { key: "reddit", name: "Reddit" },
    { key: "facebook", name: "Facebook" },
    { key: "linkedin", name: "LinkedIn" },
    { key: "netflix", name: "Netflix" },
    { key: "twitch", name: "Twitch" },
    { key: "spotify", name: "Spotify" },
    { key: "amazon", name: "Amazon" },
    { key: "google", name: "Google" },
    { key: "gitlab", name: "GitLab" },
    { key: "stackoverflow", name: "Stack Overflow" },
    { key: "notion", name: "Notion" },
    { key: "figma", name: "Figma" },
    { key: "slack", name: "Slack" },
    { key: "jira", name: "Jira" },
    { key: "medium", name: "Medium" },
    { key: "substack", name: "Substack" },
    { key: "tiktok", name: "TikTok" },
    { key: "wikipedia", name: "Wikipedia" },
    { key: "coursera", name: "Coursera" },
    { key: "udemy", name: "Udemy" },
    { key: "duolingo", name: "Duolingo" },
    { key: "leetcode", name: "LeetCode" },
    { key: "hackerrank", name: "HackerRank" },
    { key: "codeforces", name: "Codeforces" },
    { key: "discord", name: "Discord" },
    { key: "whatsapp", name: "WhatsApp" },
    { key: "telegram", name: "Telegram" },
  ];

  for (const b of brandKeywords) {
    if (d.includes(b.key)) {
      return b.name;
    }
  }

  // Leftmost label (a project on a hosting domain is named there), unless
  // it's a generic prefix: "app.example.com" is example, not "app".
  const GENERIC = /^(app|apps|web|m|mobile|mail|my|account|accounts|portal|dashboard|console|login|auth|api|en|home)$/;
  const parts = d.split(".").filter(Boolean);
  let i = 0;
  while (i < parts.length - 2 && GENERIC.test(parts[i])) i++;
  return parts[i] || d;
}

const api = {
  DAY_LABELS,
  ALL_DAYS,
  dateKey,
  todayStr,
  dateFromKey,
  addDays,
  getStoragePreference,
  setStoragePreference,
  getSites,
  saveSites,
  fmtMinutes,
  fmtDuration,
  timeStringToMinutes,
  normalizeSchedule,
  isScheduleDay,
  isWithinTimeWindow,
  limitMinutesForDate,
  getActiveRule,
  usageSecondsForDate,
  trailingWeekUsage,
  limitStreakDays,
  getTopSitesToday,
  calculateFocusScore,
  generateQuickInsight,
  getDomainCategory,
  getDomainTaxonomy,
  classifyContext,
  classifyContextAsync,
  ClassificationContext,
  ClassificationResult,
  ContentExtractorAdapter,
  GenericDomainExtractorAdapter,
  YouTubeExtractorAdapter,
  ChatGPTExtractorAdapter,
  RedditExtractorAdapter,
  ExtractorRegistry,
  ClassifierRule,
  UserOverrideClassifierRule,
  ContentExtractorClassifierRule,
  DomainRuleClassifierRule,
  FallbackClassifierRule,
  ClassificationPipeline,
  ClassificationCache,
  RULE_PRIORITY,
  registerClassifierRule,
  registerContentService,
  getContentServices,
  entryCategorySegments,
  invalidateClassificationCache,
  getClassificationEpoch,
  defaultExtractorRegistry,
  defaultClassificationPipeline,
  defaultClassificationCache,
  MACRO_CATEGORIES,
  MACRO_ORDER,
  DEFAULT_MICRO_FOR_MACRO,
  MICRO_CATEGORIES,
  MICRO_TO_MACRO,
  selectableMicrosByMacro,
  getCategoryFocusWeight,
  getDomainDisplayName,
  getCategoryBreakdown,
  getBrowsingStats,
  getDailyComparison,
  getFocusScoreTheme,
  getModerationStats,
  RESTRAINT_WAIT_SECONDS,
  RESTRAINT_PUZZLE_STREAK_REQUIRED,
  RESTRAINT_MIN_REASON_WORDS,
  RESTRAINT_TIERS,
  restraintTier,
  fmtCountdown,
  REFLECTION_QUESTIONS,
  generateHardPuzzle,
  validateOpenReason,
  RESTRAINT_PASSES_KEY,
  getRestraintPasses,
  saveRestraintPasses,
  grantRestraintPass,
  hasActiveRestraintPass,
  removeRestraintPassForTab,
  normalizeDomain,
  MODE_STRICTNESS,
  HAS_RULE_MODES,
  entryHasRule,
  isLooseningRule,
  getThemePreference,
  setThemePreference,
  applyTheme,
  effectiveModeForDate,
  dateForDay,
  SUSPEND_OPTIONS,
  isRuleSuspended,
  wasSuspendedOn,
  suspendUntil,
  suspendRule,
  resumeRule,
  suspensionLabel,
  scheduleSummary,
  ruleStatus,
  tripsForDate,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}


