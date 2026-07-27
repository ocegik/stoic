// ===== popup.js — Stoic Quick Glance Control Panel =====

// DOM Refs
const todayTotalEl = document.getElementById("todayTotal");
const topSitesList = document.getElementById("topSitesList");
const limitsTriggeredEl = document.getElementById("limitsTriggered");
const limitedSitesCountEl = document.getElementById("limitedSitesCount");
const timeSavedValEl = document.getElementById("timeSavedVal");

const openDashboardBtn = document.getElementById("openDashboardBtn");
const manageRulesBtn = document.getElementById("manageRulesBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");

function updateThemeToggleUI(theme) {
  if (!themeToggleBtn) return;
  const sunIcon = themeToggleBtn.querySelector(".sun-icon");
  const moonIcon = themeToggleBtn.querySelector(".moon-icon");

  const effectiveTheme = document.documentElement.getAttribute("data-theme") || theme;
  const isDark = effectiveTheme === "dark" || (effectiveTheme === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);

  if (isDark) {
    if (sunIcon) sunIcon.style.display = "block";
    if (moonIcon) moonIcon.style.display = "none";
    themeToggleBtn.title = "Switch to Light Mode";
    themeToggleBtn.setAttribute("aria-label", "Switch to Light Mode");
  } else {
    if (sunIcon) sunIcon.style.display = "none";
    if (moonIcon) moonIcon.style.display = "block";
    themeToggleBtn.title = "Switch to Dark Mode";
    themeToggleBtn.setAttribute("aria-label", "Switch to Dark Mode");
  }
}

async function initTheme() {
  const currentTheme = await getThemePreference();
  applyTheme(currentTheme);
  updateThemeToggleUI(currentTheme);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", async () => {
    const currentPref = await getThemePreference();
    const effectiveTheme = document.documentElement.getAttribute("data-theme") || currentPref;
    const isDarkNow = effectiveTheme === "dark" || (effectiveTheme === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const nextTheme = isDarkNow ? "light" : "dark";
    await setThemePreference(nextTheme);
    updateThemeToggleUI(nextTheme);
  });
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.prototype.hasOwnProperty.call(changes, THEME_PREF_KEY)) {
      updateThemeToggleUI(changes[THEME_PREF_KEY].newValue || "light");
    }
  });
}

function openOptions(hash = "") {
  const targetPath = hash ? `options.html${hash}` : "options.html";
  const url = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL(targetPath)
    : targetPath;

  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

if (openDashboardBtn) {
  openDashboardBtn.addEventListener("click", () => openOptions());
}

if (manageRulesBtn) {
  manageRulesBtn.addEventListener("click", () => openOptions("#tab-rules"));
}

function renderHero(sites, today) {
  const browsing = getBrowsingStats(sites, today);
  if (todayTotalEl) todayTotalEl.textContent = fmtDuration(browsing.totalSeconds);

  // 1. Daily Comparison
  const dailyCompEl = document.getElementById("dailyComp");
  if (dailyCompEl) {
    const comp = getDailyComparison(sites, today);
    dailyCompEl.textContent = comp.text;
    dailyCompEl.className = "hero-time-comp " + (comp.type || "neutral");
  }

  // 2. Circular Focus Score Gauge
  const focusGaugeEl = document.getElementById("focusGauge");
  if (focusGaugeEl) {
    const score = calculateFocusScore(sites, today);
    const theme = getFocusScoreTheme(score);
    const circumference = 131.95;
    const offset = (circumference * (1 - score / 100)).toFixed(1);

    focusGaugeEl.innerHTML = `
      <div class="focus-gauge-ring">
        <svg viewBox="0 0 52 52" class="gauge-svg">
          <circle cx="26" cy="26" r="21" class="gauge-bg" />
          <circle cx="26" cy="26" r="21" class="gauge-fill" style="stroke: ${theme.color}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset};" />
        </svg>
        <span class="gauge-val" style="color: ${theme.color}">${score}</span>
      </div>
      <span class="gauge-lbl">FOCUS SCORE</span>
    `;
  }
}

function renderTopSites(browsing) {
  if (!topSitesList) return;
  topSitesList.innerHTML = "";

  const top3 = (browsing.topWebsites || []).slice(0, 3);

  if (top3.length === 0) {
    topSitesList.innerHTML = `<div class="empty-state">No browsing activity recorded today</div>`;
    return;
  }

  const maxSec = Math.max(1, top3[0]?.seconds || 1);

  top3.forEach((item) => {
    const displayName = getDomainDisplayName(item.domain);
    const fillPct = item.seconds > 0 ? Math.max(6, Math.round((item.seconds / maxSec) * 100)) : 0;
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(item.domain)}&sz=32`;

    const row = document.createElement("div");
    row.className = "site-row";
    row.innerHTML = `
      <div class="site-favicon-box">
        <img class="site-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
        <span class="favicon-fallback" style="display:none;">${displayName.charAt(0).toUpperCase()}</span>
      </div>
      <div class="site-info">
        <div class="site-header">
          <span class="site-name">${displayName}</span>
          <span class="site-time">${fmtDuration(item.seconds)}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${fillPct}%;"></div>
        </div>
      </div>
    `;
    topSitesList.appendChild(row);
  });
}

// Master Render Loop
async function render() {
  const sites = await getSites();
  const today = todayStr();

  // 1. Browsing Stats & Hero
  renderHero(sites, today);

  const browsing = getBrowsingStats(sites, today);
  renderTopSites(browsing);

  // 2. Moderation Stats
  const moderation = getModerationStats(sites, today);
  if (limitedSitesCountEl) limitedSitesCountEl.textContent = moderation.limitedSitesCount;
  if (limitsTriggeredEl) limitsTriggeredEl.textContent = moderation.limitsTriggeredToday;
  if (timeSavedValEl) timeSavedValEl.textContent = fmtMinutes(moderation.estimatedTimeSavedMinutes);
}

// Auto-refresh on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  render();
});

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" || area === "sync") {
      render();
    }
  });
}
