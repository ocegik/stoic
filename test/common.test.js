const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dateKey,
  todayStr,
  fmtMinutes,
  timeStringToMinutes,
  normalizeSchedule,
  isScheduleDay,
  isWithinTimeWindow,
  limitMinutesForDate,
  getActiveRule,
  trailingWeekUsage,
  limitStreakDays,
  getDomainDisplayName,
} = require("../common.js");

test("getDomainDisplayName: prefers recognized brands, otherwise uses leftmost label", () => {
  assert.equal(getDomainDisplayName("ocegikodyssey.vercel.com"), "ocegikodyssey");
  assert.equal(getDomainDisplayName("student.mycollege.edu"), "student");
  assert.equal(getDomainDisplayName("notes.physicswallah.com"), "PhysicsWallah");
  assert.equal(getDomainDisplayName("youtube.com"), "YouTube");
  assert.equal(getDomainDisplayName("github.com"), "GitHub");
  assert.equal(getDomainDisplayName("chatgpt.com"), "ChatGPT");
});

test("dateKey/todayStr: return local dates as YYYY-MM-DD", () => {
  assert.equal(dateKey(new Date(2026, 6, 26, 23, 59)), "2026-07-26");
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

test("fmtMinutes: under an hour shows just minutes", () => {
  assert.equal(fmtMinutes(0), "0m");
  assert.equal(fmtMinutes(45), "45m");
  assert.equal(fmtMinutes(59.6), "1h 0m"); // rounds up to 60 first, which then splits into 1h 0m
});

test("fmtMinutes: an hour or more shows both", () => {
  assert.equal(fmtMinutes(60), "1h 0m");
  assert.equal(fmtMinutes(90), "1h 30m");
  assert.equal(fmtMinutes(125), "2h 5m");
});

test("fmtMinutes: rounds to the nearest minute", () => {
  assert.equal(fmtMinutes(29.4), "29m");
  assert.equal(fmtMinutes(29.6), "30m");
});

test("timeStringToMinutes: parses valid 24-hour times", () => {
  assert.equal(timeStringToMinutes("09:30"), 570);
  assert.equal(timeStringToMinutes("23:59"), 1439);
  assert.equal(timeStringToMinutes("24:00"), null);
});

test("normalizeSchedule: defaults old disciplines to every day, all day", () => {
  assert.deepEqual(normalizeSchedule(undefined), {
    days: [0, 1, 2, 3, 4, 5, 6],
    startTime: "",
    endTime: "",
    dayLimits: {},
  });
});

test("schedule helpers: day and focus-hour windows decide whether a discipline is active", () => {
  const entry = {
    mode: "limit",
    limitMinutes: 30,
    schedule: { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" },
  };

  assert.equal(isScheduleDay(entry, new Date(2026, 6, 27, 10, 0)), true); // Monday
  assert.equal(isScheduleDay(entry, new Date(2026, 7, 1, 10, 0)), false); // Saturday
  assert.equal(isWithinTimeWindow(entry, new Date(2026, 6, 27, 10, 0)), true);
  assert.equal(isWithinTimeWindow(entry, new Date(2026, 6, 27, 18, 0)), false);
  assert.equal(getActiveRule(entry, new Date(2026, 6, 27, 10, 0)).active, true);
  assert.equal(getActiveRule(entry, new Date(2026, 7, 1, 10, 0)).active, false);
});

test("schedule helpers: overnight windows wrap across midnight", () => {
  const entry = {
    schedule: { days: [1, 2, 3, 4, 5, 6, 0], startTime: "22:00", endTime: "06:00" },
  };

  assert.equal(isWithinTimeWindow(entry, new Date(2026, 6, 27, 23, 0)), true);
  assert.equal(isWithinTimeWindow(entry, new Date(2026, 6, 28, 5, 30)), true);
  assert.equal(isWithinTimeWindow(entry, new Date(2026, 6, 28, 12, 0)), false);
});

test("limitMinutesForDate: per-day limits override the default limit", () => {
  const entry = {
    mode: "limit",
    limitMinutes: 30,
    schedule: { dayLimits: { "1": 20, "0": 60 } },
  };

  assert.equal(limitMinutesForDate(entry, new Date(2026, 6, 27)), 20); // Monday
  assert.equal(limitMinutesForDate(entry, new Date(2026, 7, 2)), 60); // Sunday
  assert.equal(limitMinutesForDate(entry, new Date(2026, 6, 29)), 30); // Wednesday
});

test("trailingWeekUsage: combines six history days with today", () => {
  const entry = {
    mode: "limit",
    limitMinutes: 30,
    lastReset: "2026-07-26",
    usedSeconds: 120,
    history: [
      { date: "2026-07-20", seconds: 60 },
      { date: "2026-07-24", seconds: 300 },
    ],
  };

  const week = trailingWeekUsage(entry, new Date(2026, 6, 26, 10, 0));
  assert.equal(week.length, 7);
  assert.deepEqual(
    week.map((day) => [day.date, day.seconds]),
    [
      ["2026-07-20", 60],
      ["2026-07-21", 0],
      ["2026-07-22", 0],
      ["2026-07-23", 0],
      ["2026-07-24", 300],
      ["2026-07-25", 0],
      ["2026-07-26", 120],
    ]
  );
});

test("limitStreakDays: counts quiet scheduled days within limit and skips off days", () => {
  const entry = {
    mode: "limit",
    limitMinutes: 30,
    createdAt: "2026-07-20",
    lastReset: "2026-07-26",
    usedSeconds: 120,
    schedule: { days: [1, 2, 3, 4, 5, 0] }, // Saturday is off
    history: [
      { date: "2026-07-25", seconds: 9999 }, // skipped because Saturday is off
      { date: "2026-07-24", seconds: 600 },
      { date: "2026-07-23", seconds: 500 },
      { date: "2026-07-22", seconds: 400 },
    ],
  };

  assert.equal(limitStreakDays(entry, new Date(2026, 6, 26, 10, 0)), 6);
});

test("analysis helpers: getTopSitesToday, calculateFocusScore, generateQuickInsight", () => {
  const { getTopSitesToday, calculateFocusScore, generateQuickInsight } = require("../common.js");

  const sites = {
    "youtube.com": { mode: "unconstrained", usedSeconds: 1800, lastReset: "2026-07-26" },
    "reddit.com": { mode: "limit", limitMinutes: 30, usedSeconds: 600, lastReset: "2026-07-26" },
  };

  const top = getTopSitesToday(sites, "2026-07-26");
  assert.equal(top.length, 2);
  assert.equal(top[0].domain, "youtube.com");
  assert.equal(top[0].pctOfTotal, 75);

  const score = calculateFocusScore(sites, "2026-07-26");
  assert.ok(score >= 10 && score <= 100);

  const insight = generateQuickInsight(sites, "2026-07-26");
  assert.match(insight, /youtube\.com/);
});

test("calculateFocusScore: dynamically varies based on usage distribution and restraint", () => {
  const { calculateFocusScore, getCategoryFocusWeight } = require("../common.js");

  assert.equal(calculateFocusScore({}), 100, "Empty sites should return 100");

  // Productive browsing (GitHub + ChatGPT)
  const productiveSites = {
    "github.com": { mode: "unconstrained", usedSeconds: 3600, lastReset: "2026-07-26" },
    "chatgpt.com": { mode: "unconstrained", usedSeconds: 1800, lastReset: "2026-07-26" },
  };
  const prodScore = calculateFocusScore(productiveSites, "2026-07-26");
  assert.equal(prodScore, 100, "100% productive browsing should score 100");

  // Distracting browsing (YouTube + TikTok)
  const distractingSites = {
    "youtube.com": { mode: "unconstrained", usedSeconds: 3600, lastReset: "2026-07-26" },
    "tiktok.com": { mode: "unconstrained", usedSeconds: 1800, lastReset: "2026-07-26" },
  };
  const distScore = calculateFocusScore(distractingSites, "2026-07-26");
  assert.ok(distScore <= 20, `Distracting browsing should yield low score, got ${distScore}`);

  // High distraction should score lower than high productivity
  assert.ok(prodScore > distScore, "Productive browsing score must be higher than distracting browsing score");

  // Exceeding limit penalizes score
  const limitExceededSites = {
    "github.com": { mode: "unconstrained", usedSeconds: 3600, lastReset: "2026-07-26" },
    "reddit.com": { mode: "limit", limitMinutes: 15, usedSeconds: 3600, lastReset: "2026-07-26", timesTripped: 3 },
  };
  const limitScore = calculateFocusScore(limitExceededSites, "2026-07-26");
  assert.ok(limitScore < prodScore, "Breaching limits should penalize the focus score");
});

test("separation of tracking vs moderation stats: getBrowsingStats & getModerationStats", () => {
  const { getBrowsingStats, getModerationStats, getDomainCategory } = require("../common.js");

  const sites = {
    "youtube.com": { mode: "unconstrained", usedSeconds: 1800, lastReset: "2026-07-26" },
    "github.com": { mode: "unconstrained", usedSeconds: 2400, lastReset: "2026-07-26" },
    "reddit.com": { mode: "limit", limitMinutes: 30, usedSeconds: 2100, lastReset: "2026-07-26", timesTripped: 2 },
  };

  const browsing = getBrowsingStats(sites, "2026-07-26");
  assert.equal(browsing.uniqueVisitedCount, 3, "Websites Visited must reflect ALL 3 visited sites");
  assert.equal(browsing.totalMinutes, 105, "Total browsing time must aggregate all 3 sites");
  assert.equal(browsing.topWebsites[0].domain, "github.com");
  assert.ok(browsing.categoryBreakdown.macroBreakdown.length >= 2);

  const moderation = getModerationStats(sites, "2026-07-26");
  assert.equal(moderation.limitedSitesCount, 1, "Limited sites count must only count reddit.com");
  assert.equal(moderation.limitsTriggeredToday, 2, "Limits triggered count must reflect timesTripped");
});

test("hierarchical taxonomy: micro to macro mappings & classification rules", () => {
  const { getDomainTaxonomy, MICRO_TO_MACRO, MICRO_CATEGORIES, MACRO_CATEGORIES } = require("../common.js");

  // 1. Check taxonomy completeness
  assert.ok(MACRO_CATEGORIES.Productivity);
  assert.ok(MACRO_CATEGORIES.General);
  assert.ok(MACRO_CATEGORIES.Leisure);

  // Every micro belongs to exactly one macro category
  Object.keys(MICRO_CATEGORIES).forEach((micro) => {
    const macro = MICRO_TO_MACRO[micro];
    assert.ok(["Productivity", "General", "Leisure"].includes(macro), `${micro} must map to valid macro category`);
  });

  // 2. Test auto-classification by domain
  assert.deepEqual(getDomainTaxonomy("physicswallah.com"), { macro: "Productivity", micro: "Study" });
  assert.deepEqual(getDomainTaxonomy("github.com"), { macro: "Productivity", micro: "Coding" });
  assert.deepEqual(getDomainTaxonomy("chatgpt.com"), { macro: "Productivity", micro: "AI & Chatbots" });
  assert.deepEqual(getDomainTaxonomy("amazon.com"), { macro: "General", micro: "Shopping" });
  assert.deepEqual(getDomainTaxonomy("nytimes.com"), { macro: "General", micro: "News" });
  assert.deepEqual(getDomainTaxonomy("youtube.com"), { macro: "Leisure", micro: "Streaming" });
  assert.deepEqual(getDomainTaxonomy("instagram.com"), { macro: "Leisure", micro: "Social Media" });

  // 3. User overrides
  const customSites = {
    "example.com": { microCategory: "Coding", macroCategory: "Productivity" },
    "legacy.com": { category: "Productivity & Tech" }, // legacy migration to Workplace & Ops
  };

  assert.deepEqual(getDomainTaxonomy("example.com", customSites), { macro: "Productivity", micro: "Coding" });
  assert.deepEqual(getDomainTaxonomy("legacy.com", customSites), { macro: "Productivity", micro: "Workplace & Ops" });
});

test("theme preferences: getThemePreference, setThemePreference, and applyTheme", async () => {
  const { getThemePreference, setThemePreference, applyTheme } = require("../common.js");

  // Default theme should be "light"
  const defaultTheme = await getThemePreference();
  assert.equal(defaultTheme, "light");

  // Mock global document if node environment
  global.document = global.document || {
    documentElement: {
      attrMap: {},
      setAttribute(key, val) {
        this.attrMap[key] = val;
      },
      getAttribute(key) {
        return this.attrMap[key];
      },
    },
  };

  applyTheme("dark");
  assert.equal(global.document.documentElement.getAttribute("data-theme"), "dark");

  applyTheme("system");
  assert.equal(global.document.documentElement.getAttribute("data-theme"), "system");

  applyTheme("light");
  assert.equal(global.document.documentElement.getAttribute("data-theme"), "light");

  // Mock chrome storage
  let storageVal = null;
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: storageVal };
        },
        async set(obj) {
          if (obj.themePreference) storageVal = obj.themePreference;
        },
      },
    },
  };

  await setThemePreference("dark");
  const updatedTheme = await getThemePreference();
  assert.equal(updatedTheme, "dark");
  assert.equal(global.document.documentElement.getAttribute("data-theme"), "dark");
});


