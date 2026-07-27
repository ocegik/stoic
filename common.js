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

function getActiveRule(entry, date = new Date()) {
  const scheduledToday = isScheduleDay(entry, date);
  const withinHours = isWithinTimeWindow(entry, date);
  return {
    active: scheduledToday && withinHours && !entry?.paused,
    scheduledToday,
    withinHours,
    limitMinutes: limitMinutesForDate(entry, date),
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

function getDomainTaxonomy(domain, sites = null) {
  if (!domain) return { macro: "General", micro: "General Browsing" };

  const d = String(domain).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  let customMicro = null;
  let customMacro = null;

  if (sites) {
    const entry = sites[d] || sites[domain];
    if (entry) {
      if (entry.microCategory || entry.category) {
        customMicro = entry.microCategory || entry.category;
      }
      if (entry.macroCategory) {
        customMacro = entry.macroCategory;
      }
    }
  }

  // Handle legacy category string migrations
  const LEGACY_MAP = {
    "Productivity & Tech": "Workplace & Ops",
    "Video & Media": "Streaming",
    "News & Info": "News",
  };
  if (customMicro && LEGACY_MAP[customMicro]) {
    customMicro = LEGACY_MAP[customMicro];
  }

  let micro = customMicro;

  if (!micro) {
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
    } else {
      micro = "General Browsing";
    }
  }

  const macro = customMacro || MICRO_TO_MACRO[micro] || "General";
  return { macro, micro };
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
  getThemePreference,
  setThemePreference,
  applyTheme,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}


