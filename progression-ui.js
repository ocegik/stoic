// ---------- progression-ui.js ----------
// Shared presentation layer for the progression system: one render function
// per block, each a pure function of (state, ...) that returns an HTML
// string. No DOM queries, no storage access, no event listeners — popup.js
// and options.js call these and set innerHTML, which is what keeps the two
// surfaces from drifting (02-ARCHITECTURE.md §7).
//
// Also owns buildLiveDayView(), the one exception to "reads only the
// ledger": it builds today's in-progress snapshot straight from `sites` so
// the three condition chips and the popup dots update live instead of
// lagging a day behind settlement. It duplicates a slice of
// progression-engine.js's buildDaySnapshot on purpose — progression-engine.js
// is worker-only and is never loaded in a page context (02-ARCHITECTURE.md
// §2), so the only way for a page to get a live view is to build it here,
// against common.js's analytics directly.
//
// Loaded the same two ways as every other classic script here:
//   - popup.html / options.html / blocked.html load it with a <script> tag,
//     after common.js, progression-model.js and progression-store.js.
//   - Not require()'d by the test suite — markup is verified manually per
//     the checklist in 03-IMPLEMENTATION-SPEC.md, not with node --test
//     (02-ARCHITECTURE.md §8). The module.exports tail still exists so this
//     file follows the same convention as every other one in the codebase.
//
// Wrapped in an IIFE, same reason as progression-model.js/progression-store.js/
// progression-engine.js: this file destructures names (dateKey, todayStr,
// calculateFocusScore, ...) that are top-level lexical bindings in
// common.js. Once common.js's <script> tag has run, redeclaring any of
// those names at this file's true top level is a hard SyntaxError; a
// function scope shadows them locally instead, the same fix
// youtube-classifier.js already relies on.
(function () {

const commonApi = typeof module !== "undefined" && module.exports ? require("./common.js") : self;
const modelApi = typeof module !== "undefined" && module.exports ? require("./progression-model.js") : self;

const {
  dateKey,
  addDays,
  dateFromKey,
  todayStr,
  fmtDuration,
  entryCategorySegments,
  calculateFocusScore,
  usageSecondsForDate,
  isScheduleDay,
  limitMinutesForDate,
  getDomainDisplayName,
} = commonApi;

const {
  xpProgressForLevel,
  rankForLevel,
  evaluateConditions,
  ACHIEVEMENTS,
  RECORDS,
  VIOLATION_TOLERANCE_SECONDS,
  REFUSAL_MAX_PER_DOMAIN_PER_DAY,
  DEFAULT_LEISURE_CEILING_MINUTES,
  DEFAULT_FOCUS_TARGET,
  MIN_TRACKED_MINUTES_FOR_FOCUS,
} = modelApi;

const DEFAULT_LIVE_CONFIG = {
  leisureCeilingMinutes: DEFAULT_LEISURE_CEILING_MINUTES,
  focusTarget: DEFAULT_FOCUS_TARGET,
  minTrackedMinutesForFocus: MIN_TRACKED_MINUTES_FOR_FOCUS,
};

// ---------- buildLiveDayView ----------
//
// Same shape of work as buildDaySnapshot (progression-engine.js §3.1), but
// only for the in-progress day and only the fields evaluateConditions
// actually reads (trackedSeconds, leisureSeconds, focusScore, violations,
// gatesShown) — a live view has no need for the per-rule streak fold or the
// refusal domain breakdown, which only matter at settlement.
function buildLiveDayView(sites, state) {
  const config = (state && state.config) || DEFAULT_LIVE_CONFIG;
  const dayKey = (state && state.today && state.today.date) || todayStr();
  const date = dateFromKey(dayKey) || new Date();
  const gatesShownMap = (state && state.today && state.today.gatesShown) || {};
  const gatesPassedMap = (state && state.today && state.today.gatesPassed) || {};

  let trackedSeconds = 0;
  let leisureSeconds = 0;
  let violations = 0;

  for (const domain of Object.keys(sites || {})) {
    const entry = sites[domain];
    const seconds = usageSecondsForDate(entry, dayKey, dayKey);

    if (seconds > 0) {
      trackedSeconds += seconds;
      for (const seg of entryCategorySegments(domain, entry, dayKey, sites, seconds)) {
        if (seg.macro === "Leisure") leisureSeconds += seg.seconds;
      }
    }

    if (entry.paused) continue;
    if (entry.mode === "limit" && isScheduleDay(entry, date)) {
      const limitSeconds = (limitMinutesForDate(entry, date) || 0) * 60;
      if (limitSeconds > 0 && seconds > limitSeconds + VIOLATION_TOLERANCE_SECONDS) violations++;
    } else if ((entry.mode === "restraint" || entry.mode === "block") && isScheduleDay(entry, date)) {
      if ((gatesPassedMap[domain] || 0) > 0) violations++;
    }
  }

  const focusScore = calculateFocusScore(sites, dayKey);

  let gatesShown = 0;
  const gateDomains = new Set([...Object.keys(gatesShownMap), ...Object.keys(gatesPassedMap)]);
  for (const domain of gateDomains) {
    gatesShown += gatesShownMap[domain] || 0;
  }

  const snapshot = { dayKey, trackedSeconds, leisureSeconds, focusScore, violations, gatesShown };
  const conditions = evaluateConditions(snapshot, config);
  return { dayKey, snapshot, conditions, config };
}

// ---------- renderLevelIdentity ----------
// Level ring copies the focus gauge's own approach exactly (popup.js:102-111):
// an SVG circle with stroke-dasharray/stroke-dashoffset, no second technique
// invented for the same visual idea.
function renderLevelIdentity(state) {
  const progress = xpProgressForLevel(state.level.xp);
  const radius = 34;
  const circumference = Number((2 * Math.PI * radius).toFixed(2));
  const offset = (circumference * (1 - progress.pct / 100)).toFixed(1);
  const xpRemaining = Math.max(0, Math.round(progress.xpForNextLevel - progress.xpIntoLevel));

  return `
    <div class="prog-identity">
      <div class="prog-ring">
        <svg viewBox="0 0 80 80" class="prog-ring-svg">
          <circle cx="40" cy="40" r="${radius}" class="prog-ring-bg" />
          <circle cx="40" cy="40" r="${radius}" class="prog-ring-fill"
            style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset};" />
        </svg>
        <div class="prog-ring-label">
          <span class="prog-ring-level">${progress.level}</span>
          <span class="prog-ring-sub">Level</span>
        </div>
      </div>
      <div class="prog-identity-body">
        <div class="prog-rank-name">${progress.rank.name}</div>
        <div class="prog-rank-descriptor">${progress.rank.descriptor}</div>
        <div class="prog-xp-bar"><div class="prog-xp-bar-fill" style="width:${progress.pct.toFixed(1)}%;"></div></div>
        <div class="prog-xp-note">${xpRemaining} XP to Level ${progress.level + 1} · ${Math.round(state.level.xp)} XP total</div>
      </div>
    </div>
  `;
}

// ---------- renderLevelUpBanner ----------
// Shown once, in the popup and at the top of the Progress tab
// (01-PRODUCT-DESIGN.md §2.11): a quiet, dismissible inline banner, no
// modal, no animation beyond what CSS transitions the caller already has.
// Dismissal is the caller's job (no event listeners in this file) — it
// should send a PROGRESSION_EVENT of type "level_up_seen" when the
// ".prog-levelup-dismiss" button here is clicked.
function renderLevelUpBanner(state) {
  const levelUp = state.level && state.level.lastLevelUp;
  if (!levelUp || levelUp.seen) return "";
  const rank = rankForLevel(levelUp.level);
  return `
    <div class="prog-levelup-banner">
      <div class="prog-levelup-text">
        <span class="prog-levelup-level">Level ${levelUp.level}</span> reached — ${rank.name}. ${rank.descriptor}
      </div>
      <button type="button" class="prog-levelup-dismiss" aria-label="Dismiss level-up notice">Dismiss</button>
    </div>
  `;
}

// ---------- renderTodayStanding ----------

const CONDITION_DEFS = [
  {
    key: "c1",
    label: "Adherence",
    describe: (snapshot) =>
      snapshot.violations === 0 ? "No rule broken" : `${snapshot.violations} rule${snapshot.violations === 1 ? "" : "s"} broken`,
  },
  {
    key: "c2",
    label: "Restraint",
    describe: (snapshot, config) => `${fmtDuration(snapshot.leisureSeconds)} leisure · ${config.leisureCeilingMinutes}m ceiling`,
  },
  {
    key: "c3",
    label: "Focus",
    describe: (snapshot, config) => `${snapshot.focusScore} focus · ${config.focusTarget} target`,
  },
];

// liveDay comes from buildLiveDayView(), never from the settled ledger — the
// chips reflect the in-progress day so they update as the day happens.
function renderTodayStanding(liveDay) {
  const { snapshot, conditions, config } = liveDay;

  if (conditions.absent) {
    return `
      <div class="prog-standing prog-standing-absent">
        <div class="prog-condition-empty">No activity recorded yet today.</div>
      </div>
    `;
  }

  const chips = CONDITION_DEFS.map((def) => {
    const waived = def.key === "c3" && conditions.focusWaived;
    const met = conditions[def.key];
    const chipState = waived ? "waived" : met ? "met" : "unmet";
    const desc = waived ? "Waived — under 30m tracked today" : def.describe(snapshot, config);
    return `
      <div class="prog-condition prog-condition-${chipState}">
        <span class="prog-condition-dot"></span>
        <div class="prog-condition-text">
          <span class="prog-condition-label">${def.label}</span>
          <span class="prog-condition-value">${desc}</span>
        </div>
      </div>
    `;
  }).join("");

  return `<div class="prog-standing">${chips}</div>`;
}

// ---------- renderStreaks ----------

function renderStreaks(state) {
  const discipline = state.streaks.discipline;
  const bestRange = discipline.bestStart && discipline.bestEnd ? ` (${discipline.bestStart} – ${discipline.bestEnd})` : "";

  const ruleEntries = Object.entries(state.streaks.rules || {}).sort((a, b) => b[1].current - a[1].current);
  const ruleRows = ruleEntries.length
    ? ruleEntries
        .map(
          ([domain, rule]) => `
      <div class="prog-rule-streak-row">
        <span class="prog-rule-domain" title="${domain}">${getDomainDisplayName(domain)}</span>
        <span class="prog-rule-streak-value">${rule.current} current · ${rule.best} best</span>
      </div>
    `
        )
        .join("")
    : `<div class="prog-condition-empty">No rule streaks yet.</div>`;

  return `
    <div class="prog-streaks">
      <div class="prog-streak-pair">
        <div class="prog-streak-block">
          <span class="prog-streak-value">${discipline.current}</span>
          <span class="prog-streak-label">Current streak</span>
        </div>
        <div class="prog-streak-block">
          <span class="prog-streak-value">${discipline.best}</span>
          <span class="prog-streak-label">Best streak${bestRange}</span>
        </div>
      </div>
      <div class="prog-rule-streaks">${ruleRows}</div>
    </div>
  `;
}

// ---------- renderContributionGrid ----------

const GRID_COLUMNS = 53;
const GRID_ROWS = 7;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function conditionsMetCount(day) {
  return (day.c1 || 0) + (day.c2 || 0) + (day.c3 || 0);
}

// No data at all and an explicitly absent settled day render identically —
// both are "no failure happened here" (T6), so a day that hasn't been
// settled yet needs no separate visual treatment from one that was recorded
// absent.
function cellStatus(day) {
  if (!day || day.a === 1) return "absent";
  if (day.h === 1) return "held";
  return conditionsMetCount(day) > 0 ? "partial" : "missed";
}

function renderContributionGrid(state) {
  const byDate = new Map();
  for (const day of state.days || []) byDate.set(day.d, day);

  const todayKey = (state.today && state.today.date) || todayStr();
  const anchor = dateFromKey(todayKey) || new Date();
  // Align the grid so every column is a complete Sunday-Saturday week, the
  // same alignment GitHub's own contribution grid uses. The handful of
  // cells that land after `anchor` in the final column have no DayRecord
  // yet (the day hasn't happened) and fall through the same "absent"
  // styling as any other undocumented day — there is no separate "future"
  // state to invent.
  const endOfWeek = addDays(anchor, 6 - anchor.getDay());
  const start = addDays(endOfWeek, -(GRID_COLUMNS * GRID_ROWS - 1));

  let cellsHtml = "";
  let monthsHtml = "";
  let prevMonth = null;

  for (let col = 0; col < GRID_COLUMNS; col++) {
    const colStart = addDays(start, col * GRID_ROWS);
    const month = colStart.getMonth();
    if (month !== prevMonth) {
      monthsHtml += `<span class="prog-grid-month" style="grid-column:${col + 1};">${MONTH_ABBR[month]}</span>`;
      prevMonth = month;
    }
    for (let row = 0; row < GRID_ROWS; row++) {
      const date = addDays(colStart, row);
      const key = dateKey(date);
      if (date > anchor) {
        cellsHtml += `<span class="prog-cell prog-cell-absent" style="grid-column:${col + 1}; grid-row:${row + 1};" title="${key}"></span>`;
        continue;
      }
      const day = byDate.get(key);
      const status = cellStatus(day);
      const title = day ? `${key} · ${status}` : `${key} · no data`;
      cellsHtml += `<span class="prog-cell prog-cell-${status}" style="grid-column:${col + 1}; grid-row:${row + 1};" title="${title}"></span>`;
    }
  }

  return `
    <div class="prog-grid-wrap">
      <div class="prog-grid-months">${monthsHtml}</div>
      <div class="prog-grid">${cellsHtml}</div>
      <div class="prog-grid-legend">
        <span class="prog-grid-legend-lbl">Less</span>
        <span class="prog-cell prog-cell-absent"></span>
        <span class="prog-cell prog-cell-missed"></span>
        <span class="prog-cell prog-cell-partial"></span>
        <span class="prog-cell prog-cell-held"></span>
        <span class="prog-grid-legend-lbl">More</span>
      </div>
    </div>
  `;
}

// ---------- renderRecords ----------

const RECORD_FORMATTERS = {
  longest_streak: (v) => `${v} day${v === 1 ? "" : "s"}`,
  most_productive_day: (v) => fmtDuration(v),
  lowest_leisure_day: (v) => fmtDuration(v),
  longest_rule_run: (v) => `${v} day${v === 1 ? "" : "s"}`,
  most_held_month: (v) => `${v} day${v === 1 ? "" : "s"}`,
};

function renderRecords(state) {
  const tiles = RECORDS.map((def) => {
    const record = state.records[def.id];
    const format = RECORD_FORMATTERS[def.id] || ((v) => `${v}`);
    const value = record ? format(record.value) : "—";
    const meta = record && record.meta && record.meta.domain ? ` · ${getDomainDisplayName(record.meta.domain)}` : "";
    return `
      <div class="prog-record-tile">
        <div class="prog-record-value">${value}${meta}</div>
        <div class="prog-record-label">${def.label}</div>
        ${record ? `<div class="prog-record-date">${record.date}</div>` : ""}
      </div>
    `;
  }).join("");
  return `<div class="prog-records">${tiles}</div>`;
}

// ---------- renderAchievements ----------
// Earned first, then locked with criterion + progress visible (T4 — no
// hidden achievements). Progress is computed against the same fields the
// model's own predicates read (01-PRODUCT-DESIGN.md §2.6), never against
// def.test() — the ledger's state.achievements map is the one source of
// truth for "earned," and it is never re-derived here.
function renderAchievements(state) {
  const ctx = { lifetime: state.lifetime, streaks: state.streaks, days: state.days };
  const earned = [];
  const locked = [];
  for (const def of ACHIEVEMENTS) {
    if (state.achievements[def.id]) earned.push(def);
    else locked.push(def);
  }

  const earnedHtml =
    earned
      .map((def) => {
        const record = state.achievements[def.id];
        return `
      <div class="prog-achievement-card prog-achievement-earned">
        <div class="prog-achievement-name">${def.name}</div>
        <div class="prog-achievement-criterion">${def.criterion}</div>
        <div class="prog-achievement-meta">+${def.xp} XP · ${record.at}</div>
      </div>
    `;
      })
      .join("") || `<div class="prog-condition-empty">None yet.</div>`;

  const lockedHtml = locked
    .map((def) => {
      const progress = def.progress ? def.progress(ctx) : null;
      const pct = progress && progress.target ? Math.min(100, Math.round((progress.current / progress.target) * 100)) : null;
      const progressHtml =
        pct !== null
          ? `
        <div class="prog-achievement-progress"><div class="prog-achievement-progress-fill" style="width:${pct}%;"></div></div>
        <div class="prog-achievement-meta">${progress.current} / ${progress.target}</div>
      `
          : `<div class="prog-achievement-meta">${def.xp} XP</div>`;
      return `
      <div class="prog-achievement-card prog-achievement-locked">
        <div class="prog-achievement-name">${def.name}</div>
        <div class="prog-achievement-criterion">${def.criterion}</div>
        ${progressHtml}
      </div>
    `;
    })
    .join("");

  return `
    <div class="prog-achievements">
      <div class="prog-achievement-group">
        <div class="section-label small">Earned (${earned.length}/${ACHIEVEMENTS.length})</div>
        <div class="prog-achievement-grid">${earnedHtml}</div>
      </div>
      <div class="prog-achievement-group">
        <div class="section-label small">Locked</div>
        <div class="prog-achievement-grid">${lockedHtml}</div>
      </div>
    </div>
  `;
}

// ---------- renderLifetime ----------
// Reuses .stat-grid / .stat-cell from components.css directly — a lifetime
// tally is exactly the shape that component already renders, so it needs no
// prog-prefixed CSS of its own.
function renderLifetime(state) {
  const l = state.lifetime;
  const tiles = [
    { value: l.firstDay || "—", label: "Tracking since" },
    { value: l.daysTracked || 0, label: "Days tracked" },
    { value: l.daysHeld || 0, label: "Days held" },
    { value: fmtDuration(l.trackedSeconds || 0), label: "Time tracked" },
    { value: fmtDuration(l.productiveSeconds || 0), label: "Productive time" },
    { value: fmtDuration(l.leisureSeconds || 0), label: "Leisure time" },
    { value: l.refusals || 0, label: "Refusals" },
    { value: l.gatesShown || 0, label: "Gates shown" },
    { value: l.gatesPassed || 0, label: "Gates passed" },
    { value: l.violations || 0, label: "Violations" },
    { value: l.rulesCreated || 0, label: "Rules created" },
    { value: l.rulesLoosened || 0, label: "Rules loosened" },
  ];
  const cells = tiles
    .map(
      (t) => `
      <div class="stat-cell">
        <div class="stat-value">${t.value}</div>
        <div class="stat-label">${t.label}</div>
      </div>
    `
    )
    .join("");
  return `<div class="stat-grid">${cells}</div>`;
}

// ---------- renderPopupStrip ----------
// One compact row: level/rank, XP bar, today's three condition dots (live,
// per buildLiveDayView — not settled), current streak. Must not grow beyond
// one row (01-PRODUCT-DESIGN.md §7 — it must not displace the focus gauge or
// the top-sites list).
function renderPopupStrip(state, liveDay) {
  const progress = xpProgressForLevel(state.level.xp);
  const conditions = liveDay.conditions;

  const dotClass = (key) => {
    if (conditions.absent) return "prog-dot-absent";
    if (key === "c3" && conditions.focusWaived) return "prog-dot-waived";
    return conditions[key] ? "prog-dot-met" : "prog-dot-unmet";
  };
  const dots = ["c1", "c2", "c3"].map((key) => `<span class="prog-strip-dot ${dotClass(key)}"></span>`).join("");

  return `
    <div class="prog-strip-identity">
      <span class="prog-strip-level">Lv ${progress.level}</span>
      <span class="prog-strip-rank">${progress.rank.name}</span>
    </div>
    <div class="prog-strip-xp"><div class="prog-strip-xp-fill" style="width:${progress.pct.toFixed(1)}%;"></div></div>
    <div class="prog-strip-dots">${dots}</div>
    <div class="prog-strip-streak">
      <span class="prog-strip-streak-num">${state.streaks.discipline.current}</span>
      <span class="prog-strip-streak-lbl">streak</span>
    </div>
  `;
}

// ---------- exports ----------

const progressionUiApi = {
  buildLiveDayView,
  renderLevelIdentity,
  renderLevelUpBanner,
  renderTodayStanding,
  renderStreaks,
  renderContributionGrid,
  renderRecords,
  renderAchievements,
  renderLifetime,
  renderPopupStrip,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = progressionUiApi;
} else {
  Object.assign(self, progressionUiApi);
}

})();
