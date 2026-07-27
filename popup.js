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

  // 3. Classification Debugger
  renderDebugInfo();
}

async function renderDebugInfo() {
  const dbgToggleBtn = document.getElementById("debugToggleBtn");
  const debugContent = document.getElementById("debugContent");
  const debugBadgeSource = document.getElementById("debugBadgeSource");

  if (dbgToggleBtn && debugContent && !dbgToggleBtn.dataset.wired) {
    dbgToggleBtn.dataset.wired = "true";
    dbgToggleBtn.addEventListener("click", () => {
      const isHidden = debugContent.style.display === "none";
      debugContent.style.display = isHidden ? "flex" : "none";
    });
  }

  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;

  try {
    const info = await chrome.runtime.sendMessage({ type: "GET_CLASSIFICATION_DEBUG_INFO" });
    if (!info) return;

    const dbgVideoId = document.getElementById("dbgVideoId");
    const dbgTitle = document.getElementById("dbgTitle");
    const dbgChannel = document.getElementById("dbgChannel");
    const dbgContentType = document.getElementById("dbgContentType");
    const dbgChannelLookup = document.getElementById("dbgChannelLookup");
    const dbgCacheStatus = document.getElementById("dbgCacheStatus");
    const dbgSource = document.getElementById("dbgSource");
    const dbgConfidence = document.getElementById("dbgConfidence");

    if (dbgVideoId) dbgVideoId.textContent = info.metadata?.videoId || "--";
    if (dbgTitle) dbgTitle.textContent = info.metadata?.title || "--";
    if (dbgChannel) dbgChannel.textContent = info.metadata?.channelName || info.metadata?.channelId || "--";
    if (dbgContentType) dbgContentType.textContent = info.metadata?.contentType || "video";

    if (dbgChannelLookup) {
      if (info.channelLookup?.hit) {
        const cls = info.channelLookup.channel?.classification;
        dbgChannelLookup.textContent = `HIT (${cls ? `${cls.macro}·${cls.micro}` : "Found"})`;
        dbgChannelLookup.style.color = "var(--sem-green-soft)";
      } else {
        dbgChannelLookup.textContent = "MISS (Domain Fallback)";
        dbgChannelLookup.style.color = "var(--text-muted)";
      }
    }

    if (dbgCacheStatus) dbgCacheStatus.textContent = info.cacheStatus || "MISS";

    const source = info.classification?.source || "domain_rule";
    if (dbgSource) dbgSource.textContent = source;
    if (debugBadgeSource) {
      debugBadgeSource.textContent = source.includes("ai") ? "AI" : (source.includes("manual") ? "MANUAL" : (source.includes("channel") ? "Channel DB" : "Domain"));
    }

    if (dbgConfidence) {
      const conf = Math.round((info.classification?.confidence || 0.8) * 100);
      dbgConfidence.textContent = `${conf}%`;
    }

    const dbgReason = document.getElementById("dbgReason");
    if (dbgReason) {
      dbgReason.textContent = info.classification?.metadata?.reason || info.channelLookup?.channel?.reason || "--";
    }
  } catch {
    /* Ignore background connection errors */
  }
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

