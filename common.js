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

function limitMinutesForDate(entry, date = new Date()) {
  const fallback = cleanPositiveMinutes(entry?.limitMinutes) || 0;
  if (entry?.mode !== "limit") return fallback;
  const schedule = normalizeSchedule(entry.schedule);
  return schedule.dayLimits[String(date.getDay())] || fallback;
}

const RESTRAINT_TYPES = ["countdown", "confirmation", "quote", "reflection", "math", "random"];
const DEFAULT_RESTRAINT_TYPE = "countdown";
const DEFAULT_COUNTDOWN_SECONDS = 15;

const REFLECTION_QUESTIONS = [
  "Is opening this site helping your primary goal today?",
  "What specific task or feeling are you seeking a break from right now?",
  "Will browsing this site for 10 minutes leave you feeling energized or drained?",
  "Is this visit intentional, or a reflexive habit?",
  "What would your future self wish you did right now?",
  "Are you looking for specific information, or seeking a quick distraction?",
  "Could this time be better spent taking a real break away from screens?",
];

function generateMathPuzzle() {
  const num1 = Math.floor(Math.random() * 9) + 1;
  const num2 = Math.floor(Math.random() * 9) + 1;
  const operators = ["+", "-", "×"];
  const op = operators[Math.floor(Math.random() * operators.length)];
  let question = "";
  let answer = 0;
  if (op === "+") {
    question = `${num1} + ${num2} = ?`;
    answer = num1 + num2;
  } else if (op === "-") {
    const max = Math.max(num1, num2);
    const min = Math.min(num1, num2);
    question = `${max} - ${min} = ?`;
    answer = max - min;
  } else {
    question = `${num1} × ${num2} = ?`;
    answer = num1 * num2;
  }
  return { question, answer };
}

function resolveRestraintType(configuredType) {
  const validTypes = ["countdown", "confirmation", "quote", "reflection", "math"];
  if (configuredType === "random") {
    return validTypes[Math.floor(Math.random() * validTypes.length)];
  }
  return validTypes.includes(configuredType) ? configuredType : "countdown";
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

async function grantRestraintPass(domain, durationMinutes = 15) {
  const cleanDomain = normalizeDomain(domain);
  if (!cleanDomain) return null;
  const passes = await getRestraintPasses();
  const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
  passes[cleanDomain] = { grantedAt: Date.now(), expiresAt };
  await saveRestraintPasses(passes);
  return passes[cleanDomain];
}

async function hasActiveRestraintPass(domain) {
  const cleanDomain = normalizeDomain(domain);
  if (!cleanDomain) return false;
  const passes = await getRestraintPasses();
  const now = Date.now();

  let hasExpired = false;
  for (const passKey of Object.keys(passes)) {
    if (passes[passKey] && now > passes[passKey].expiresAt) {
      delete passes[passKey];
      hasExpired = true;
    }
  }
  if (hasExpired) {
    await saveRestraintPasses(passes);
  }

  // Exact match
  if (passes[cleanDomain] && now <= passes[cleanDomain].expiresAt) {
    return true;
  }

  // Parent / subdomain matching
  for (const passKey of Object.keys(passes)) {
    const cleanPassKey = normalizeDomain(passKey);
    if (passes[passKey] && now <= passes[passKey].expiresAt) {
      if (
        cleanDomain === cleanPassKey ||
        cleanDomain.endsWith("." + cleanPassKey) ||
        cleanPassKey.endsWith("." + cleanDomain)
      ) {
        return true;
      }
    }
  }

  return false;
}

function getActiveRule(entry, date = new Date()) {
  const scheduledToday = isScheduleDay(entry, date);
  const withinHours = isWithinTimeWindow(entry, date);
  return {
    active: scheduledToday && withinHours && !entry?.paused,
    scheduledToday,
    withinHours,
    limitMinutes: limitMinutesForDate(entry, date),
    mode: entry?.mode || "unconstrained",
    restraintType: entry?.restraintType || DEFAULT_RESTRAINT_TYPE,
    countdownSeconds: cleanPositiveMinutes(entry?.countdownSeconds) || DEFAULT_COUNTDOWN_SECONDS,
  };
}

function usageSecondsForDate(entry, key, today = todayStr()) {
  if (!entry) return 0;
  if (key === today && entry.lastReset === today) return entry.usedSeconds || 0;
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
        paused: !!entry.paused,
      });
    }
  });

  list.sort((a, b) => b.seconds - a.seconds);

  return list.map((item) => ({
    ...item,
    pctOfTotal: totalSeconds > 0 ? Math.round((item.seconds / totalSeconds) * 100) : 0,
  }));
}

const MACRO_CATEGORIES = {
  Productivity: { name: "Productivity", weight: 1.0, badgeClass: "macro-productivity" },
  General: { name: "General", weight: 0.6, badgeClass: "macro-general" },
  Leisure: { name: "Leisure", weight: 0.1, badgeClass: "macro-leisure" },
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
};

const MICRO_TO_MACRO = Object.keys(MICRO_CATEGORIES).reduce((acc, micro) => {
  acc[micro] = MICRO_CATEGORIES[micro].macro;
  return acc;
}, {});

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

class ChannelClassifierRule extends ClassifierRule {
  constructor() {
    super("channel_database");
  }

  classify(context, sites = null) {
    if (!context) return null;
    const d = context.domain;
    const isYouTube = d === "youtube.com" || d.endsWith(".youtube.com") || d === "youtu.be";
    if (!isYouTube) return null;

    const channelId = context.channelId || (context.metadata ? context.metadata.channelId : null);
    const channelName = context.channelName || (context.metadata ? context.metadata.channelName : null);

    const channelDb = (context.metadata && context.metadata.channelDb)
      ? context.metadata.channelDb
      : (sites && sites._yt_channels ? sites._yt_channels : null);

    let matchedChannel = null;
    if (channelDb && typeof channelDb === "object") {
      if (channelId && channelDb[channelId]) {
        matchedChannel = channelDb[channelId];
      } else if (channelName) {
        matchedChannel = Object.values(channelDb).find(
          (c) => c && c.channelName && c.channelName.toLowerCase() === String(channelName).toLowerCase()
        );
      }
    }

    if (matchedChannel && matchedChannel.classification && matchedChannel.classification.micro && matchedChannel.classification.micro !== "Unclassified") {
      const micro = matchedChannel.classification.micro;
      const macro = matchedChannel.classification.macro || MICRO_TO_MACRO[micro] || "General";
      return new ClassificationResult({
        macro,
        micro,
        confidence: Number(matchedChannel.confidence) || 0.9,
        source: matchedChannel.source === "ai" ? "ai_channel_database" : (matchedChannel.source === "manual" ? "manual_channel_database" : "channel_database"),
        metadata: {
          channelId: matchedChannel.channelId || channelId,
          channelName: matchedChannel.channelName || channelName,
          reason: matchedChannel.reason || null,
          source: matchedChannel.source || "channel_database",
          updatedAt: matchedChannel.updatedAt || null,
        },
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

class ClassificationPipeline {
  constructor() {
    this.rules = [];
  }

  addRule(rule) {
    if (rule && typeof rule.classify === "function") {
      this.rules.push(rule);
    }
  }

  classify(context, sites = null) {
    const ctx = ClassificationContext.create(context);
    for (const rule of this.rules) {
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

// Caching Layer
class ClassificationCache {
  constructor(maxSize = 500, ttlMs = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  makeKey(context, sites = null) {
    const ctx = ClassificationContext.create(context);
    const sitesHash = sites ? JSON.stringify(sites) : "no_sites";
    return ctx.url ? `url:${ctx.url}::${sitesHash}` : `domain:${ctx.domain}::${sitesHash}`;
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

// ---------- AI Classifier Provider Architecture ----------

class BaseAIClassifierProvider {
  constructor(name = "base") {
    this.name = name;
  }

  async classifyChannel(channelInfo) {
    return null;
  }
}

class HeuristicAIClassifierProvider extends BaseAIClassifierProvider {
  constructor() {
    super("heuristic_ai");
  }

  async classifyChannel(channelInfo) {
    const name = String(channelInfo.channelName || channelInfo.channelId || "").toLowerCase();
    const primaryTitle = String(channelInfo.videoTitle || channelInfo.title || "").toLowerCase();
    const extraTitles = Array.isArray(channelInfo.videoTitles) ? channelInfo.videoTitles.map((t) => String(t).toLowerCase()) : [];
    const allTitles = [primaryTitle, ...extraTitles].filter(Boolean);
    const combined = `${name} ${allTitles.join(" ")}`;

    let micro = null;
    let reason = "Heuristic keyword analysis";
    let confidence = 0.85;

    // 1. Coding / Software Development (checked before general study so tech tutorials classify as Coding)
    if (/code|coding|programmer|programming|developer|dev|javascript|python|react|node|rust|c\+\+|java|github|leetcode|framework|html|css|webdev|fireship|traversy|freecodecamp/i.test(combined)) {
      micro = "Coding";
      reason = "Software development, programming, or coding keywords detected";
      confidence = 0.92;
    }
    // 2. Study / Education
    else if (/coursera|udemy|edx|lecture|course|tutorial|learn|university|academy|math|physics|algebra|calculus|geometry|biology|chemistry|science|history|philosophy|khan|veritasium|31415|3blue1brown|numberphile|mit|stanford|harvard|pw\.live|physicswallah/i.test(combined)) {
      micro = "Study";
      reason = "Educational, academic, or tutorial keywords detected in channel/video context";
      confidence = 0.90;
    }
    // 3. AI & Chatbots
    else if (/chatgpt|openai|llm|ai news|artificial intelligence|machine learning|deep learning|prompt|gpt-4|claude|gemini/i.test(combined)) {
      micro = "AI & Chatbots";
      reason = "Artificial intelligence or LLM topics detected";
      confidence = 0.88;
    }
    // 4. Research & Reference
    else if (/paper|arxiv|research|documentary|TED|tedx|essay|analysis|deep dive|explainer/i.test(combined)) {
      micro = "Research & Reference";
      reason = "Research, documentary, or analytical content keywords detected";
      confidence = 0.85;
    }
    // 5. News & Current Events
    else if (/news|daily|report|politics|breaking|bulletin|bbc|cnn|reuters|journal|vox/i.test(combined)) {
      micro = "News";
      reason = "News, reporting, or current events topics detected";
      confidence = 0.88;
    }
    // 6. Gaming
    else if (/gameplay|walkthrough|playthrough|ign|nintendo|playstation|xbox|minecraft|roblox|fortnite|esports|speedrun|twitch/i.test(combined)) {
      micro = "Gaming";
      reason = "Gaming, walkthrough, or esports keywords detected";
      confidence = 0.90;
    }
    // 7. Streaming / Entertainment
    else if (/vlog|music|official video|trailer|movie|show|comedy|sketch|reaction|funny|highlights|podcast|clip|entertainment/i.test(combined)) {
      micro = "Streaming";
      reason = "General entertainment, music, or vlog content detected";
      confidence = 0.85;
    }

    if (micro) {
      const macro = MICRO_TO_MACRO[micro] || "General";
      return {
        macro,
        micro,
        confidence,
        reason: allTitles.length > 1 ? `${reason} (analyzed ${allTitles.length} recent channel titles)` : reason,
        source: "ai",
      };
    }

    return {
      macro: "General",
      micro: "Unclassified",
      confidence: 0.50,
      reason: "No high-confidence channel topics identified from current metadata",
      source: "ai_unclassified",
    };
  }
}

class CustomAPIClassifierProvider extends BaseAIClassifierProvider {
  constructor({ name = "custom_api", apiKey = "", endpoint = "" } = {}) {
    super(name);
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fallback = new HeuristicAIClassifierProvider();
  }

  async classifyChannel(channelInfo) {
    if (!this.apiKey || !this.endpoint) {
      return this.fallback.classifyChannel(channelInfo);
    }
    const titlesList = Array.isArray(channelInfo.videoTitles) && channelInfo.videoTitles.length > 0
      ? channelInfo.videoTitles.join("; ")
      : (channelInfo.videoTitle || "");

    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          prompt: `Classify YouTube channel "${channelInfo.channelName || channelInfo.channelId}" based on video titles: [${titlesList}]. Return JSON with macro and micro category.`,
        }),
      });
      const data = await res.json();
      if (data && data.micro) {
        return {
          macro: data.macro || MICRO_TO_MACRO[data.micro] || "General",
          micro: data.micro,
          confidence: data.confidence || 0.9,
          reason: data.reason || "Remote API classification",
          source: "ai",
        };
      }
    } catch (err) {
      console.error("[Stoic AI] Remote API classification failed, using fallback:", err);
    }
    return this.fallback.classifyChannel(channelInfo);
  }
}

class AIClassifierRegistry {
  constructor() {
    this.provider = new HeuristicAIClassifierProvider();
  }

  setProvider(provider) {
    if (provider && typeof provider.classifyChannel === "function") {
      this.provider = provider;
    }
  }

  getProvider() {
    return this.provider;
  }

  async classifyChannel(channelInfo) {
    return this.provider.classifyChannel(channelInfo);
  }
}

const defaultAIClassifierRegistry = new AIClassifierRegistry();

const inFlightAIClassifications = new Map();
const DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.70;
const AI_SETTINGS_KEY = "ai_settings";
const DEFAULT_AI_SETTINGS = {
  provider: "heuristic", // "heuristic" | "custom_api"
  apiKey: "",
  apiEndpoint: "",
  confidenceThreshold: 0.70,
  autoClassify: true,
};

let inMemoryAISettings = null;

async function getAISettings() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const { [AI_SETTINGS_KEY]: settings } = await chrome.storage.local.get(AI_SETTINGS_KEY);
    return { ...DEFAULT_AI_SETTINGS, ...(settings || {}) };
  }
  return inMemoryAISettings ? { ...DEFAULT_AI_SETTINGS, ...inMemoryAISettings } : { ...DEFAULT_AI_SETTINGS };
}

async function saveAISettings(settings) {
  const updated = { ...DEFAULT_AI_SETTINGS, ...settings };
  inMemoryAISettings = updated;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [AI_SETTINGS_KEY]: updated });
  }
  return updated;
}

async function classifyUnknownChannel(metadata, options = {}) {
  if (!metadata) return null;
  const channelId = metadata.channelId || metadata.channelName;
  const channelName = metadata.channelName || metadata.channelId;

  if (!channelId && !channelName) return null;

  const forceReclassify = options.forceReclassify === true;
  const aiSettings = await getAISettings();

  const autoClassify = options.autoClassify !== undefined ? options.autoClassify : aiSettings.autoClassify;
  if (!autoClassify && !forceReclassify) {
    return (await getChannel(channelId)) || (await getChannel(channelName));
  }

  const confidenceThreshold = options.confidenceThreshold !== undefined
    ? options.confidenceThreshold
    : (aiSettings.confidenceThreshold !== undefined ? aiSettings.confidenceThreshold : DEFAULT_AI_CONFIDENCE_THRESHOLD);

  const existing = (await getChannel(channelId)) || (await getChannel(channelName));

  // Requirement: Manual overrides must NEVER be overwritten automatically!
  if (existing && existing.source === "manual" && !forceReclassify) {
    return existing;
  }

  // Reuse cached AI classification permanently unless forcing reclassify!
  if (existing && existing.classification && existing.classification.micro !== "Unclassified" && existing.source === "ai" && !forceReclassify) {
    return existing;
  }

  const key = String(channelId || channelName).trim().toLowerCase();
  if (inFlightAIClassifications.has(key)) {
    return inFlightAIClassifications.get(key);
  }

  const classificationPromise = (async () => {
    try {
      // Build richer channel profile using recent video titles stored in database
      const videoDb = await getVideoDatabase();
      const channelVideos = Object.values(videoDb).filter((v) => {
        if (!v) return false;
        if (channelId && v.channelId === channelId) return true;
        if (channelName && v.channelName && v.channelName.toLowerCase() === channelName.toLowerCase()) return true;
        return false;
      });
      const recentTitles = channelVideos.map((v) => v.title).filter(Boolean).slice(-10);
      const currentTitle = metadata.title || metadata.videoTitle || "";
      if (currentTitle && !recentTitles.includes(currentTitle)) {
        recentTitles.push(currentTitle);
      }

      let provider = options.provider;
      if (!provider) {
        if (aiSettings.provider === "custom_api" && aiSettings.apiKey && aiSettings.apiEndpoint) {
          provider = new CustomAPIClassifierProvider({
            apiKey: aiSettings.apiKey,
            endpoint: aiSettings.apiEndpoint,
          });
        } else {
          provider = defaultAIClassifierRegistry.getProvider();
        }
      }

      let aiResult = null;
      let attempts = 0;
      const maxAttempts = options.maxRetries || 2;
      while (attempts < maxAttempts) {
        try {
          aiResult = await provider.classifyChannel({
            channelId,
            channelName,
            videoTitle: currentTitle,
            videoTitles: recentTitles,
            contentType: metadata.contentType || "video",
            url: metadata.url || "",
          });
          if (aiResult) break;
        } catch (err) {
          attempts++;
          if (attempts >= maxAttempts) throw err;
          await new Promise((r) => setTimeout(r, 150 * attempts));
        }
      }

      if (!aiResult) return existing || null;

      const isLowConfidence = aiResult.confidence < confidenceThreshold;

      let classification = null;
      let source = "ai";

      if (isLowConfidence) {
        classification = { macro: "General", micro: "Unclassified" };
        source = "ai_unclassified";
      } else {
        classification = {
          macro: aiResult.macro || MICRO_TO_MACRO[aiResult.micro] || "General",
          micro: aiResult.micro,
        };
        source = options.manual ? "manual" : (aiResult.source || "ai");
      }

      const updatedChannel = {
        channelId: channelId || key,
        channelName: channelName || key,
        classification,
        confidence: aiResult.confidence !== undefined ? aiResult.confidence : 0.85,
        reason: aiResult.reason || "AI classification",
        source,
        updatedAt: new Date().toISOString(),
      };

      await saveChannel(updatedChannel);
      return updatedChannel;
    } catch (err) {
      console.error("[Stoic AI] Channel classification error:", err);
      return existing || null;
    } finally {
      inFlightAIClassifications.delete(key);
    }
  })();

  inFlightAIClassifications.set(key, classificationPromise);
  return classificationPromise;
}

// YouTube Storage & Database Helpers
const YT_CHANNELS_KEY = "yt_channels";
const YT_VIDEOS_KEY = "yt_videos";

let inMemoryChannelDb = {};
let inMemoryVideoDb = {};

async function getChannelDatabase() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const { [YT_CHANNELS_KEY]: channels = {} } = await chrome.storage.local.get(YT_CHANNELS_KEY);
    inMemoryChannelDb = channels || {};
    return channels || {};
  }
  return inMemoryChannelDb || {};
}

async function saveChannelDatabase(channels) {
  inMemoryChannelDb = channels || {};
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [YT_CHANNELS_KEY]: channels });
  }
}

async function getChannel(channelIdOrName) {
  if (!channelIdOrName) return null;
  const db = await getChannelDatabase();
  if (db[channelIdOrName]) return db[channelIdOrName];
  const queryLower = String(channelIdOrName).toLowerCase();
  return Object.values(db).find((c) => c && (c.channelId === channelIdOrName || (c.channelName && c.channelName.toLowerCase() === queryLower))) || null;
}

async function saveChannel(channelData) {
  if (!channelData || (!channelData.channelId && !channelData.channelName)) return null;
  const db = await getChannelDatabase();
  const key = channelData.channelId || channelData.channelName;
  const existing = db[key] || {};
  const updated = {
    channelId: channelData.channelId || existing.channelId || key,
    channelName: channelData.channelName || existing.channelName || key,
    classification: channelData.classification || existing.classification || { macro: "Leisure", micro: "Streaming" },
    confidence: channelData.confidence !== undefined ? channelData.confidence : (existing.confidence || 0.9),
    reason: channelData.reason || existing.reason || "",
    source: channelData.source || existing.source || "manual",
    updatedAt: channelData.updatedAt || new Date().toISOString(),
  };
  db[updated.channelId] = updated;
  if (updated.channelName && updated.channelName !== updated.channelId) {
    db[updated.channelName] = updated;
  }
  await saveChannelDatabase(db);
  return updated;
}

async function getVideoDatabase() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const { [YT_VIDEOS_KEY]: videos = {} } = await chrome.storage.local.get(YT_VIDEOS_KEY);
    inMemoryVideoDb = videos || {};
    return videos || {};
  }
  return inMemoryVideoDb || {};
}

async function saveVideoDatabase(videos) {
  inMemoryVideoDb = videos || {};
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [YT_VIDEOS_KEY]: videos });
  }
}

async function getVideo(videoId) {
  if (!videoId) return null;
  const db = await getVideoDatabase();
  return db[videoId] || null;
}

async function saveVideo(videoData) {
  if (!videoData || !videoData.videoId) return null;
  const db = await getVideoDatabase();
  const existing = db[videoData.videoId] || {};
  const updated = {
    videoId: videoData.videoId,
    title: videoData.title || existing.title || "",
    channelId: videoData.channelId || existing.channelId || null,
    channelName: videoData.channelName || existing.channelName || null,
    contentType: videoData.contentType || existing.contentType || "video",
    updatedAt: videoData.updatedAt || new Date().toISOString(),
  };
  db[videoData.videoId] = updated;
  await saveVideoDatabase(db);
  return updated;
}

async function recordYouTubeVisit(metadata) {
  if (!metadata || (!metadata.videoId && !metadata.channelId && !metadata.channelName)) return null;

  let savedVideo = null;
  if (metadata.videoId) {
    savedVideo = await saveVideo(metadata);
  }

  const channelQuery = metadata.channelId || metadata.channelName;
  let channelHit = false;
  let existingChannel = null;

  if (channelQuery) {
    existingChannel = await getChannel(channelQuery);
    if (existingChannel && existingChannel.classification && existingChannel.classification.micro !== "Unclassified") {
      channelHit = true;
    } else {
      // Trigger AI classification for unknown channel in background
      classifyUnknownChannel(metadata).catch((err) => {
        console.error("[Stoic AI] Background channel classification error:", err);
      });
    }
  }

  return {
    video: savedVideo,
    channel: existingChannel,
    channelHit,
  };
}

// Singletons & Core API Entry Points
const defaultExtractorRegistry = new ExtractorRegistry();
defaultExtractorRegistry.register(new YouTubeExtractorAdapter());
defaultExtractorRegistry.register(new ChatGPTExtractorAdapter());
defaultExtractorRegistry.register(new RedditExtractorAdapter());

const defaultClassificationPipeline = new ClassificationPipeline();
defaultClassificationPipeline.addRule(new UserOverrideClassifierRule());
defaultClassificationPipeline.addRule(new ContentExtractorClassifierRule());
defaultClassificationPipeline.addRule(new ChannelClassifierRule());
defaultClassificationPipeline.addRule(new DomainRuleClassifierRule());
defaultClassificationPipeline.addRule(new FallbackClassifierRule());

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

async function classifyContextAsync(input, sites = null, options = {}) {
  const channelDb = options.channelDb || await getChannelDatabase();
  const extra = { ...options.extraContext };
  extra.channelDb = channelDb;

  return classifyContext(input, sites, {
    ...options,
    extraContext: extra,
  });
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

function getCategoryFocusWeight(category) {
  const cat = typeof category === "object" ? category.macro : category;
  switch (cat) {
    case "Productivity":
      return 1.0;
    case "General":
      return 0.6;
    case "Leisure":
      return 0.1;
    default:
      return 0.6;
  }
}

function calculateFocusScore(sites, today = todayStr()) {
  let totalSeconds = 0;
  let weightedSeconds = 0;
  let trippedPenalty = 0;

  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    const sec = usageSecondsForDate(entry, today, today);
    if (sec <= 0) return;

    totalSeconds += sec;
    const { macro } = getDomainTaxonomy(domain, sites);
    const catWeight = getCategoryFocusWeight(macro);
    const mode = entry.mode || "unconstrained";
    let siteWeight = catWeight;

    if (mode === "block") {
      siteWeight = 0.0;
    } else if (mode === "limit") {
      const limitSec = (limitMinutesForDate(entry, dateFromKey(today) || new Date()) || entry.limitMinutes || 30) * 60;
      if (sec <= limitSec) {
        siteWeight = Math.max(catWeight, 0.7);
      } else {
        siteWeight = Math.min(catWeight, 0.1);
      }
    }

    weightedSeconds += sec * siteWeight;

    if (entry.lastReset === today && entry.timesTripped > 0) {
      trippedPenalty += entry.timesTripped * 3;
    }
  });

  if (totalSeconds === 0) return 100;

  const baseRatio = weightedSeconds / totalSeconds;
  const rawScore = Math.round(baseRatio * 100) - Math.min(25, trippedPenalty);

  return Math.min(100, Math.max(10, rawScore));
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
    return `Stoic enforced moderation on ${moderation.limitsTriggeredToday} occasion${moderation.limitsTriggeredToday > 1 ? 's' : ''} today, saving an estimated ${fmtMinutes(moderation.estimatedTimeSavedMinutes)}.`;
  }

  if (moderation.limitedSitesCount > 0 && moderation.limitsTriggeredToday === 0) {
    return `Great restraint today — you have not hit any moderation limits so far.`;
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
      const { macro, micro } = getDomainTaxonomy(domain, sites);
      if (!macros[macro]) {
        macros[macro] = { name: macro, seconds: 0, micros: {} };
      }
      macros[macro].seconds += sec;
      macros[macro].micros[micro] = (macros[macro].micros[micro] || 0) + sec;
    }
  });

  const macroList = Object.keys(macros).map((mac) => {
    const mData = macros[mac];
    const microList = Object.keys(mData.micros).map((mic) => ({
      micro: mic,
      macro: mac,
      seconds: mData.micros[mic],
      minutes: Math.round(mData.micros[mic] / 60),
      pctOfMacro: mData.seconds > 0 ? Math.round((mData.micros[mic] / mData.seconds) * 100) : 0,
      pctOfTotal: totalSeconds > 0 ? Math.round((mData.micros[mic] / totalSeconds) * 100) : 0,
    })).sort((a, b) => b.seconds - a.seconds);

    return {
      macro: mac,
      seconds: mData.seconds,
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
      allSitesList.push({
        domain,
        entry,
        seconds: sec,
        minutes: Math.round(sec / 60),
        mode: entry.mode || "unconstrained",
        paused: !!entry.paused,
        taxonomy,
        category: taxonomy.micro,
        macroCategory: taxonomy.macro,
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
  if (s <= 20) {
    return { label: "Very Low", color: "#ef4444", class: "score-very-low" };
  } else if (s <= 40) {
    return { label: "Low", color: "#f97316", class: "score-low" };
  } else if (s <= 60) {
    return { label: "Medium", color: "#eab308", class: "score-medium" };
  } else if (s <= 80) {
    return { label: "Good", color: "#22c55e", class: "score-good" };
  } else {
    return { label: "Excellent", color: "#15803d", class: "score-excellent" };
  }
}

function getModerationStats(sites, today = todayStr()) {
  let limitedSitesCount = 0;
  let limitsTriggeredToday = 0;
  let totalTimesTripped = 0;
  let estimatedTimeSavedMinutes = 0;
  const activeRulesList = [];

  Object.keys(sites || {}).forEach((domain) => {
    const entry = sites[domain];
    if (entry.mode === "limit" || entry.mode === "block") {
      limitedSitesCount++;
      const tripped = entry.timesTripped || 0;
      totalTimesTripped += tripped;
      if (entry.lastReset === today && tripped > 0) {
        limitsTriggeredToday += tripped;
      }
      
      const usedSec = usageSecondsForDate(entry, today, today);
      const limitSec = (entry.limitMinutes || 30) * 60;
      if (entry.mode === "block") {
        estimatedTimeSavedMinutes += Math.round(usedSec / 60) + 30;
      } else if (usedSec >= limitSec) {
        estimatedTimeSavedMinutes += Math.round((usedSec - limitSec) / 60) + 15;
      }

      activeRulesList.push({
        domain,
        entry,
        mode: entry.mode,
        limitMinutes: entry.limitMinutes || 0,
        usedSeconds: usedSec,
        timesTripped: tripped,
        paused: !!entry.paused,
      });
    }
  });

  return {
    limitedSitesCount,
    limitsTriggeredToday,
    totalTimesTripped,
    estimatedTimeSavedMinutes,
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
  ];

  for (const b of brandKeywords) {
    if (d.includes(b.key)) {
      return b.name;
    }
  }

  const parts = d.split(".");
  const leftmost = parts[0] || d;
  return leftmost;
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
  ChannelClassifierRule,
  DomainRuleClassifierRule,
  FallbackClassifierRule,
  ClassificationPipeline,
  ClassificationCache,
  defaultExtractorRegistry,
  defaultClassificationPipeline,
  defaultClassificationCache,
  BaseAIClassifierProvider,
  HeuristicAIClassifierProvider,
  CustomAPIClassifierProvider,
  AIClassifierRegistry,
  defaultAIClassifierRegistry,
  classifyUnknownChannel,
  getAISettings,
  saveAISettings,
  AI_SETTINGS_KEY,
  DEFAULT_AI_SETTINGS,
  DEFAULT_AI_CONFIDENCE_THRESHOLD,
  YT_CHANNELS_KEY,
  YT_VIDEOS_KEY,
  getChannelDatabase,
  saveChannelDatabase,
  getChannel,
  saveChannel,
  getVideoDatabase,
  saveVideoDatabase,
  getVideo,
  saveVideo,
  recordYouTubeVisit,
  MACRO_CATEGORIES,
  MICRO_CATEGORIES,
  MICRO_TO_MACRO,
  getCategoryFocusWeight,
  getDomainDisplayName,
  getCategoryBreakdown,
  getBrowsingStats,
  getDailyComparison,
  getFocusScoreTheme,
  getModerationStats,
  RESTRAINT_TYPES,
  DEFAULT_RESTRAINT_TYPE,
  DEFAULT_COUNTDOWN_SECONDS,
  REFLECTION_QUESTIONS,
  generateMathPuzzle,
  resolveRestraintType,
  RESTRAINT_PASSES_KEY,
  getRestraintPasses,
  saveRestraintPasses,
  grantRestraintPass,
  hasActiveRestraintPass,
  normalizeDomain,
  getThemePreference,
  setThemePreference,
  applyTheme,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}


