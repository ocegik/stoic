// ===== options.js — Stoic Analytics & Moderation Dashboard =====

document.addEventListener("DOMContentLoaded", async () => {
  // Navigation Tabs
  const tabs = document.querySelectorAll(".nav-tab");
  const panels = document.querySelectorAll(".tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      panels.forEach((p) => {
        p.classList.remove("active");
        p.hidden = true;
      });

      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");

      const targetId = tab.getAttribute("data-target");
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add("active");
        targetPanel.hidden = false;
      }
    });
  });

  // Check URL hash for direct tab switching (e.g. #tab-rules)
  const hash = window.location.hash.replace("#", "");
  if (hash) {
    const targetTab = Array.from(tabs).find((t) => t.getAttribute("data-target") === hash);
    if (targetTab) {
      targetTab.click();
    }
  }

  // State
  let sites = {};
  let storagePref = "local";
  let activeFilter = "all";
  let searchQuery = "";
  let editingDomainKey = null;

  // Overview Page Refs
  const optTodayTotal = document.getElementById("optTodayTotal");
  const optFocusScore = document.getElementById("optFocusScore");
  const optTopWebsitesList = document.getElementById("optTopWebsitesList");
  const optOverviewRulesActive = document.getElementById("optOverviewRulesActive");
  const optOverviewTrippedCount = document.getElementById("optOverviewTrippedCount");
  const optOverviewTimeSaved = document.getElementById("optOverviewTimeSaved");

  // Moderation Rules Summary Refs
  const optModLimitedCount = document.getElementById("optModLimitedCount");
  const optModTrippedCount = document.getElementById("optModTrippedCount");
  const optModTimeSaved = document.getElementById("optModTimeSaved");

  // Panel & Grid Refs
  const optDisciplinesGrid = document.getElementById("optDisciplinesGrid");
  const optEmptyState = document.getElementById("optEmptyState");
  const siteSearchInput = document.getElementById("siteSearchInput");
  const filterModeSeg = document.getElementById("filterModeSeg");
  const optAddSiteBtn = document.getElementById("optAddSiteBtn");
  const optCreateFirstBtn = document.getElementById("optCreateFirstBtn");

  const optSyncToggle = document.getElementById("optSyncToggle");
  const optExportBtn = document.getElementById("optExportBtn");
  const optImportBtn = document.getElementById("optImportBtn");
  const optImportFile = document.getElementById("optImportFile");
  const optImportNote = document.getElementById("optImportNote");
  const optResetAllBtn = document.getElementById("optResetAllBtn");

  const optAnalyticsChart = document.getElementById("optAnalyticsChart");
  const optCategoryGrid = document.getElementById("optCategoryGrid");
  const optDomainAuditTable = document.getElementById("optDomainAuditTable");
  const optStreaksList = document.getElementById("optStreaksList");

  // Modal refs
  const optModal = document.getElementById("optModal");
  const optModalTitle = document.getElementById("optModalTitle");
  const optModalCloseBtn = document.getElementById("optModalCloseBtn");
  const optModalCancelBtn = document.getElementById("optModalCancelBtn");
  const optModalForm = document.getElementById("optModalForm");
  const optModalDomain = document.getElementById("optModalDomain");
  const optModalDomainError = document.getElementById("optModalDomainError");
  const optModalModeSeg = document.getElementById("optModalModeSeg");
  const optModalMinutes = document.getElementById("optModalMinutes");
  const optModalLimitRow = document.getElementById("optModalLimitRow");
  const optModalDayPicker = document.getElementById("optModalDayPicker");
  const optModalStartTime = document.getElementById("optModalStartTime");
  const optModalEndTime = document.getElementById("optModalEndTime");

  const optModalRestraintRow = document.getElementById("optModalRestraintRow");
  const optModalRestraintType = document.getElementById("optModalRestraintType");
  const optModalCountdownGroup = document.getElementById("optModalCountdownGroup");
  const optModalCountdownSec = document.getElementById("optModalCountdownSec");

  let modalMode = "limit";

  function wireSegmented(container, onChange) {
    if (!container) return;
    container.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        onChange(btn.getAttribute("data-value") || btn.getAttribute("data-filter"));
      });
    });
  }

  wireSegmented(filterModeSeg, (val) => {
    activeFilter = val;
    renderDisciplines();
  });

  wireSegmented(optModalModeSeg, (val) => {
    modalMode = val;
    optModalLimitRow.style.display = val === "limit" ? "flex" : "none";
    if (optModalRestraintRow) optModalRestraintRow.style.display = val === "restraint" ? "flex" : "none";
  });

  if (optModalRestraintType) {
    optModalRestraintType.addEventListener("change", () => {
      const showSec = optModalRestraintType.value === "countdown" || optModalRestraintType.value === "random";
      if (optModalCountdownGroup) optModalCountdownGroup.style.display = showSec ? "flex" : "none";
    });
  }

  if (siteSearchInput) {
    siteSearchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderDisciplines();
    });
  }

  const optThemeSeg = document.getElementById("optThemeSeg");

  function updateThemeSegUI(theme) {
    if (!optThemeSeg) return;
    optThemeSeg.querySelectorAll(".seg-btn").forEach((btn) => {
      const val = btn.getAttribute("data-value");
      if (val === theme) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  wireSegmented(optThemeSeg, async (val) => {
    if (val) {
      await setThemePreference(val);
    }
  });

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.prototype.hasOwnProperty.call(changes, THEME_PREF_KEY)) {
        updateThemeSegUI(changes[THEME_PREF_KEY].newValue || "light");
      }
    });
  }

  async function loadData() {
    sites = await getSites();
    storagePref = await getStoragePreference();
    const currentTheme = await getThemePreference();
    applyTheme(currentTheme);
    updateThemeSegUI(currentTheme);
    renderAll();
  }

  function renderAll() {
    const today = todayStr();
    const browsing = getBrowsingStats(sites, today);
    const moderation = getModerationStats(sites, today);
    const focusScore = calculateFocusScore(sites, today);

    // 1. Overview Hero Summary & Focus Score Component
    if (optTodayTotal) optTodayTotal.textContent = fmtDuration(browsing.totalSeconds);
    if (optFocusScore) optFocusScore.textContent = `${focusScore}%`;

    const optFocusGaugePath = document.getElementById("optFocusGaugePath");
    const optFocusScoreSub = document.getElementById("optFocusScoreSub");
    if (optFocusGaugePath) {
      optFocusGaugePath.setAttribute("stroke-dasharray", `${focusScore}, 100`);
      if (focusScore >= 80) {
        optFocusGaugePath.style.stroke = "var(--sem-green)";
        if (optFocusScoreSub) optFocusScoreSub.textContent = "High Restraint";
      } else if (focusScore >= 50) {
        optFocusGaugePath.style.stroke = "var(--sem-amber)";
        if (optFocusScoreSub) optFocusScoreSub.textContent = "Moderate Restraint";
      } else {
        optFocusGaugePath.style.stroke = "var(--sem-red)";
        if (optFocusScoreSub) optFocusScoreSub.textContent = "Attention Needed";
      }
    }

    // 2. Overview Top Websites (Compact Ranked List: Favicon, Name, Usage Bar, Time, Percentage)
    renderOverviewTopWebsites(browsing.topWebsites);

    // 3. Overview Behaviour Summary (Compact Row: Limits Triggered, Rules Active, Time Saved)
    if (optOverviewTrippedCount) optOverviewTrippedCount.textContent = moderation.limitsTriggeredToday;
    if (optOverviewRulesActive) optOverviewRulesActive.textContent = moderation.limitedSitesCount;
    if (optOverviewTimeSaved) optOverviewTimeSaved.textContent = fmtMinutes(moderation.estimatedTimeSavedMinutes);

    // 4. Detailed Analysis AI Insight
    const optInsightText = document.getElementById("optInsightText");
    if (optInsightText) optInsightText.textContent = generateQuickInsight(sites, today);

    // 5. Rules Moderation Performance Summary
    if (optModLimitedCount) optModLimitedCount.textContent = moderation.limitedSitesCount;
    if (optModTrippedCount) optModTrippedCount.textContent = moderation.limitsTriggeredToday;
    if (optModTimeSaved) optModTimeSaved.textContent = fmtMinutes(moderation.estimatedTimeSavedMinutes);

    renderSyncSection();
    renderAnalytics(browsing);
    renderDisciplines(moderation);
  }

  function renderOverviewTopWebsites(topWebsites) {
    if (!optTopWebsitesList) return;
    optTopWebsitesList.innerHTML = "";

    if (!topWebsites || topWebsites.length === 0) {
      optTopWebsitesList.innerHTML = `<div class="empty-top-sites">No website activity recorded today.</div>`;
      return;
    }

    const top5 = topWebsites.slice(0, 5);
    top5.forEach((item) => {
      const displayName = getDomainDisplayName(item.domain);
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${item.domain}&sz=32`;
      const initial = (displayName.charAt(0) || "?").toUpperCase();

      const row = document.createElement("div");
      row.className = "top-site-row";
      row.innerHTML = `
        <div class="top-site-favicon-box">
          <img class="top-site-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <span class="top-site-avatar-fallback" style="display:none;">${initial}</span>
        </div>
        <div class="top-site-name">${displayName}</div>
        <div class="top-site-bar-container">
          <div class="top-site-bar-fill" style="width: ${Math.max(4, item.pctOfTotal)}%;"></div>
        </div>
        <div class="top-site-time">${fmtDuration(item.seconds)}</div>
        <div class="top-site-pct">${item.pctOfTotal}%</div>
      `;
      optTopWebsitesList.appendChild(row);
    });
  }

  function renderSyncSection() {
    if (optSyncToggle) optSyncToggle.checked = storagePref === "sync";
  }

  function renderAnalytics(browsing) {
    const today = new Date();

    // 7-Day Usage Aggregation Chart
    const daysMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const key = dateKey(d);
      daysMap[key] = { label: DAY_LABELS[d.getDay()], seconds: 0 };
    }

    Object.values(sites).forEach((entry) => {
      const week = trailingWeekUsage(entry, today);
      week.forEach((w) => {
        if (daysMap[w.date]) {
          daysMap[w.date].seconds += w.seconds;
        }
      });
    });

    const maxSec = Math.max(1, ...Object.values(daysMap).map((d) => d.seconds));
    if (optAnalyticsChart) {
      optAnalyticsChart.innerHTML = "";

      Object.values(daysMap).forEach((day) => {
        const col = document.createElement("div");
        col.className = "chart-bar-col";
        const heightPct = day.seconds > 0 ? Math.max(6, Math.round((day.seconds / maxSec) * 100)) : 0;
        const displayVal = day.seconds > 0 ? fmtDuration(day.seconds) : "0m";

        col.innerHTML = `
          <div class="chart-val">${displayVal}</div>
          <div class="chart-bar" style="height:${heightPct}%"></div>
          <div class="chart-label">${day.label}</div>
        `;
        optAnalyticsChart.appendChild(col);
      });
    }

    // Category Grid
    renderCategoryGrid(browsing.categoryBreakdown);

    // Websites Visited Audit Table
    renderAuditTable(browsing);
  }

  function renderCategoryGrid(categoryBreakdown) {
    if (!optCategoryGrid) return;
    optCategoryGrid.innerHTML = "";

    const macroBreakdown = categoryBreakdown?.macroBreakdown || [];

    if (!macroBreakdown || macroBreakdown.length === 0) {
      optCategoryGrid.innerHTML = `<div style="font-size:12px; color:var(--text-faint); padding:12px 0;">No browsing categories recorded today yet. Visit websites to build your breakdown!</div>`;
      return;
    }

    const colorMap = {
      Productivity: "#10b981",
      General: "#0284c7",
      Leisure: "#f59e0b",
    };

    macroBreakdown.forEach((mac) => {
      const card = document.createElement("div");
      card.className = "category-card";

      const barColor = colorMap[mac.macro] || "var(--accent)";
      const microItemsHtml = mac.micros.map((m) => `
        <div class="micro-item-row">
          <span class="micro-item-name">${m.micro}</span>
          <span class="micro-item-time">${fmtDuration(m.seconds)} (${m.pctOfMacro}% of ${mac.macro.toLowerCase()})</span>
        </div>
      `).join("");

      card.innerHTML = `
        <div class="cat-card-header">
          <span class="cat-card-title">
            <span class="macro-badge macro-${mac.macro.toLowerCase()}">${mac.macro}</span>
          </span>
          <span class="cat-card-pct">${mac.pctOfTotal}% of total</span>
        </div>
        <div class="cat-card-val">${fmtDuration(mac.seconds)}</div>
        <div class="cat-progress-bg">
          <div class="cat-progress-fill" style="width:${mac.pctOfTotal}%; background:${barColor};"></div>
        </div>
        ${mac.micros.length > 0 ? `
          <div class="micro-list-container">
            ${microItemsHtml}
          </div>
        ` : ""}
      `;
      optCategoryGrid.appendChild(card);
    });
  }

  function renderAuditTable(browsing) {
    if (!optDomainAuditTable) return;
    optDomainAuditTable.innerHTML = "";

    if (!browsing.topWebsites || browsing.topWebsites.length === 0) {
      optDomainAuditTable.innerHTML = `<div style="font-size:12px; color:var(--text-faint); padding:16px 0;">No website activity recorded today yet. Visit websites to view real-time session tracking!</div>`;
      return;
    }

    let html = `
      <table style="width:100%; border-collapse:collapse; font-size:12.5px;">
        <thead>
          <tr style="border-bottom:1px solid var(--border-soft); text-align:left; color:var(--text-faint); font-weight:600; text-transform:uppercase; font-size:10px; letter-spacing:0.06em;">
            <th style="padding:10px 8px;">Website</th>
            <th style="padding:10px 8px;">Hierarchy (Macro & Micro)</th>
            <th style="padding:10px 8px;">Tracked Today</th>
            <th style="padding:10px 8px;">Status & Moderation</th>
            <th style="padding:10px 8px; text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    const taxonomyGroups = {
      Productivity: ["Study", "Coding", "AI & Chatbots", "Documentation", "Workplace & Ops", "Research & Reference"],
      General: ["Email", "Shopping", "Banking & Finance", "News", "Search & Utilities", "General Browsing"],
      Leisure: ["Social Media", "Streaming", "Gaming", "Entertainment", "Forums & Community", "Messaging"],
    };

    browsing.topWebsites.forEach((item) => {
      const displayName = getDomainDisplayName(item.domain);
      const { macro, micro } = item.taxonomy || getDomainTaxonomy(item.domain, sites);

      let statusBadge = `<span style="padding:3px 8px; border-radius:6px; font-size:10px; font-weight:700; background:var(--accent-dim); color:var(--accent-soft); border:1px solid var(--accent-ring);">UNCONSTRAINED</span>`;
      if (item.paused) {
        statusBadge = `<span style="padding:3px 8px; border-radius:6px; font-size:10px; font-weight:700; background:var(--bg-raised); color:var(--text-faint); border:1px solid var(--border-soft);">PAUSED</span>`;
      } else if (item.mode === "limit") {
        statusBadge = `<span style="padding:3px 8px; border-radius:6px; font-size:10px; font-weight:700; background:var(--sem-amber-dim); color:var(--sem-amber-soft); border:1px solid var(--sem-amber-border);">${item.entry.limitMinutes || 30}m LIMIT</span>`;
      } else if (item.mode === "block") {
        statusBadge = `<span style="padding:3px 8px; border-radius:6px; font-size:10px; font-weight:700; background:var(--sem-red-dim); color:var(--sem-red-soft); border:1px solid var(--sem-red-border);">RESTRAINT</span>`;
      } else if (item.mode === "restraint") {
        const rLabel = (item.entry?.restraintType || "countdown").toUpperCase();
        statusBadge = `<span style="padding:3px 8px; border-radius:6px; font-size:10px; font-weight:700; background:rgba(2, 132, 199, 0.12); color:#0284c7; border:1px solid rgba(2, 132, 199, 0.25);">${rLabel} RESTRAINT</span>`;
      }

      let categoryOptionsHtml = "";
      Object.keys(taxonomyGroups).forEach((macGroup) => {
        categoryOptionsHtml += `<optgroup label="${macGroup}">`;
        taxonomyGroups[macGroup].forEach((micOpt) => {
          categoryOptionsHtml += `<option value="${micOpt}" ${micro === micOpt ? "selected" : ""}>${micOpt}</option>`;
        });
        categoryOptionsHtml += `</optgroup>`;
      });

      if (!MICRO_TO_MACRO[micro] && micro) {
        categoryOptionsHtml += `<option value="${micro}" selected>${micro}</option>`;
      }
      categoryOptionsHtml += `<option value="__custom__">+ Custom Micro Category...</option>`;

      const macroBadgeHtml = `<span class="macro-badge macro-${macro.toLowerCase()}">${macro}</span>`;
      const catSelectHtml = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          ${macroBadgeHtml}
          <select class="audit-cat-select" data-domain="${item.domain}" style="padding:4px 8px; font-size:11px; border-radius:6px; border:1px solid var(--border-soft); background:var(--bg-panel); color:var(--text-primary); cursor:pointer;">
            ${categoryOptionsHtml}
          </select>
        </div>
      `;

      html += `
        <tr style="border-bottom:1px solid var(--border-soft);">
          <td style="padding:12px 8px; font-weight:700; color:var(--text-primary);" title="${item.domain}">${displayName}</td>
          <td style="padding:12px 8px;">${catSelectHtml}</td>
          <td style="padding:12px 8px;">
            <div style="font-weight:700; font-family:var(--mono); color:var(--text-primary);">${fmtDuration(item.seconds)}</div>
            <div style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">${item.pctOfTotal}% of session</div>
          </td>
          <td style="padding:12px 8px;">${statusBadge}</td>
          <td style="padding:12px 8px; text-align:right;">
            <button class="btn-ghost audit-action-btn" data-domain="${item.domain}" style="padding:5px 10px; font-size:11px; font-weight:600;">
              ${item.mode === "unconstrained" ? "+ Limit" : "Edit Rule"}
            </button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    optDomainAuditTable.innerHTML = html;

    optDomainAuditTable.querySelectorAll(".audit-cat-select").forEach((select) => {
      select.addEventListener("change", async (e) => {
        const domain = e.target.dataset.domain;
        let selectedMicro = e.target.value;
        let selectedMacro = MICRO_TO_MACRO[selectedMicro] || "General";

        if (selectedMicro === "__custom__") {
          const customMicro = prompt(`Enter custom micro category for ${domain}:`, "Study");
          if (!customMicro || !customMicro.trim()) {
            renderAll();
            return;
          }
          selectedMicro = customMicro.trim();
          const customMacroInput = prompt(`Select Macro Category for ${selectedMicro} (Productivity, General, or Leisure):`, "Productivity");
          if (customMacroInput && ["Productivity", "General", "Leisure"].includes(customMacroInput.trim())) {
            selectedMacro = customMacroInput.trim();
          }
        }

        const currentSites = await getSites();
        if (!currentSites[domain]) {
          currentSites[domain] = { mode: "unconstrained" };
        }
        currentSites[domain].microCategory = selectedMicro;
        currentSites[domain].macroCategory = selectedMacro;
        currentSites[domain].category = selectedMicro;
        await saveSites(currentSites);
        renderAll();
      });
    });

    optDomainAuditTable.querySelectorAll(".audit-action-btn").forEach((btn) => {
      btn.addEventListener("click", () => openModal(btn.dataset.domain));
    });
  }

  function renderDisciplines(moderation) {
    if (!optDisciplinesGrid) return;
    const keys = Object.keys(sites).filter(
      (d) => sites[d].mode === "limit" || sites[d].mode === "block" || sites[d].mode === "restraint"
    );

    const filteredKeys = keys.filter((domain) => {
      const entry = sites[domain];
      if (activeFilter !== "all" && entry.mode !== activeFilter) return false;
      if (searchQuery && !domain.toLowerCase().includes(searchQuery)) return false;
      return true;
    });

    optDisciplinesGrid.innerHTML = "";

    if (filteredKeys.length === 0) {
      optDisciplinesGrid.hidden = true;
      if (optEmptyState) optEmptyState.hidden = false;
    } else {
      optDisciplinesGrid.hidden = false;
      if (optEmptyState) optEmptyState.hidden = true;

      filteredKeys.forEach((domain) => {
        const entry = sites[domain];
        const displayName = getDomainDisplayName(domain);
        const card = document.createElement("div");
        card.className = "discipline-card";

        const isBlock = entry.mode === "block";
        const isRestraint = entry.mode === "restraint";
        let badgeText = "Time Limit";
        if (isBlock) badgeText = "Full Block";
        else if (isRestraint) badgeText = "Restraint Mode";

        let ruleText = `${entry.limitMinutes || 30} min/day`;
        if (isBlock) ruleText = "Blocked full day";
        else if (isRestraint) {
          const rTypeStr = (entry.restraintType || "countdown").toUpperCase();
          ruleText = `${rTypeStr} (${entry.countdownSeconds || 15}s)`;
        }

        const rule = getActiveRule(entry);
        const usedSec = usageSecondsForDate(entry, todayStr());
        const usedTodayStr = fmtMinutes(usedSec / 60);
        const limitSec = (entry.limitMinutes || 30) * 60;
        const usedPct = isBlock ? 100 : (isRestraint ? 0 : Math.min(100, Math.round((usedSec / limitSec) * 100)));
        const streak = limitStreakDays(entry);

        let progressColor = "var(--sem-green)";
        if (usedPct >= 100) progressColor = "var(--sem-red)";
        else if (usedPct >= 75) progressColor = "var(--sem-amber)";
        const taxonomy = getDomainTaxonomy(domain, sites);

        card.innerHTML = `
          <div>
            <div class="discipline-card-header">
              <span class="discipline-domain" title="${domain}">${displayName}</span>
              <span class="discipline-badge mode-${entry.mode}">${badgeText}</span>
            </div>
            <div class="discipline-meta" style="margin-top: 10px;">
              <div><strong>Hierarchy:</strong> <span class="macro-badge macro-${taxonomy.macro.toLowerCase()}">${taxonomy.macro}</span> <span class="micro-badge">${taxonomy.micro}</span></div>
              <div><strong>Rule:</strong> ${ruleText}</div>
              <div><strong>Tracked Today:</strong> ${usedTodayStr}</div>
              <div><strong>Times Tripped:</strong> ${entry.timesTripped || 0}×</div>
              ${streak > 0 ? `<div><strong>Streak:</strong> <span style="color:var(--text-primary); font-weight:700;">${streak} day${streak === 1 ? "" : "s"}</span></div>` : ""}
              <div><strong>Status:</strong> ${entry.paused ? "Paused" : rule.active ? "Active" : "Off-schedule"}</div>
            </div>
            ${!isBlock && !isRestraint ? `
              <div class="cat-progress-bg" style="margin-top: 10px;">
                <div class="cat-progress-fill" style="width:${usedPct}%; background:${progressColor};"></div>
              </div>
            ` : ""}
          </div>
          <div class="discipline-card-actions">
            <button class="btn-ghost edit-btn" type="button">Edit</button>
            <button class="btn-ghost pause-btn" type="button">${entry.paused ? "Resume" : "Pause"}</button>
            <button class="btn-ghost delete-btn" type="button" style="color:var(--error); border-color:var(--error-border);">Delete</button>
          </div>
        `;

        card.querySelector(".edit-btn").addEventListener("click", () => openModal(domain));
        card.querySelector(".pause-btn").addEventListener("click", async () => {
          entry.paused = !entry.paused;
          await saveSites(sites);
          renderAll();
        });
        card.querySelector(".delete-btn").addEventListener("click", async () => {
          if (confirm(`Remove moderation rule for ${displayName}?`)) {
            delete sites[domain];
            await saveSites(sites);
            renderAll();
          }
        });

        optDisciplinesGrid.appendChild(card);
      });
    }

    // Streaks List
    if (optStreaksList) {
      optStreaksList.innerHTML = "";
      if (keys.length === 0) {
        optStreaksList.innerHTML = `<div style="font-size:12px; color:var(--text-faint); padding:10px 0;">No active site moderation rules set yet.</div>`;
        return;
      }

      keys.forEach((domain) => {
        const entry = sites[domain];
        const displayName = getDomainDisplayName(domain);
        const streak = limitStreakDays(entry);
        const row = document.createElement("div");
        row.className = "streak-item";
        row.innerHTML = `
          <span class="streak-domain" title="${domain}">${displayName}</span>
          <span class="streak-badge">${streak} day${streak === 1 ? "" : "s"} streak</span>
        `;
        optStreaksList.appendChild(row);
      });
    }
  }

  // Modal logic
  function openModal(domainKey = null) {
    editingDomainKey = domainKey;
    optModalDomainError.style.display = "none";
    optModalDomainError.textContent = "";

    if (domainKey && sites[domainKey]) {
      const entry = sites[domainKey];
      const displayName = getDomainDisplayName(domainKey);
      optModalTitle.textContent = `Configure Rule · ${displayName}`;
      optModalDomain.value = domainKey;
      optModalDomain.disabled = true;
      modalMode = entry.mode === "unconstrained" ? "limit" : entry.mode;
      optModalMinutes.value = entry.limitMinutes || 30;
      if (optModalRestraintType) optModalRestraintType.value = entry.restraintType || "countdown";
      if (optModalCountdownSec) optModalCountdownSec.value = entry.countdownSeconds || 15;

      const schedule = normalizeSchedule(entry.schedule);
      optModalStartTime.value = schedule.startTime || "";
      optModalEndTime.value = schedule.endTime || "";

      optModalDayPicker.querySelectorAll(".day-btn").forEach((btn) => {
        const d = Number(btn.getAttribute("data-day"));
        btn.classList.toggle("active", schedule.days.includes(d));
      });
    } else {
      optModalTitle.textContent = "New Moderation Rule";
      optModalDomain.value = "";
      optModalDomain.disabled = false;
      modalMode = "limit";
      optModalMinutes.value = "30";
      if (optModalRestraintType) optModalRestraintType.value = "countdown";
      if (optModalCountdownSec) optModalCountdownSec.value = "15";
      optModalStartTime.value = "";
      optModalEndTime.value = "";
      optModalDayPicker.querySelectorAll(".day-btn").forEach((btn) => btn.classList.add("active"));
    }

    optModalModeSeg.querySelectorAll(".seg-btn").forEach((btn) => {
      const isMatch = btn.getAttribute("data-value") === modalMode;
      btn.classList.toggle("active", isMatch);
    });
    optModalLimitRow.style.display = modalMode === "limit" ? "flex" : "none";
    if (optModalRestraintRow) optModalRestraintRow.style.display = modalMode === "restraint" ? "flex" : "none";

    const showSec = !optModalRestraintType || optModalRestraintType.value === "countdown" || optModalRestraintType.value === "random";
    if (optModalCountdownGroup) optModalCountdownGroup.style.display = showSec ? "flex" : "none";

    optModal.showModal();
  }

  function closeModal() {
    optModal.close();
  }

  if (optAddSiteBtn) optAddSiteBtn.addEventListener("click", () => openModal(null));
  if (optCreateFirstBtn) optCreateFirstBtn.addEventListener("click", () => openModal(null));
  if (optModalCloseBtn) optModalCloseBtn.addEventListener("click", closeModal);
  if (optModalCancelBtn) optModalCancelBtn.addEventListener("click", closeModal);

  optModalDayPicker.querySelectorAll(".day-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
    });
  });

  optModalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rawDomain = optModalDomain.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

    if (!rawDomain) {
      optModalDomainError.textContent = "Please enter a valid domain.";
      optModalDomainError.style.display = "block";
      return;
    }

    const selectedDays = [];
    optModalDayPicker.querySelectorAll(".day-btn.active").forEach((btn) => {
      selectedDays.push(Number(btn.getAttribute("data-day")));
    });

    const limitMin = Number(optModalMinutes.value) || 30;
    const rType = optModalRestraintType ? optModalRestraintType.value : "countdown";
    const cSec = optModalCountdownSec ? (Math.max(5, Math.min(60, Number(optModalCountdownSec.value) || 15))) : 15;
    const existing = sites[rawDomain] || {};

    sites[rawDomain] = {
      ...existing,
      mode: modalMode,
      limitMinutes: modalMode === "limit" ? limitMin : 0,
      restraintType: modalMode === "restraint" ? rType : (existing.restraintType || "countdown"),
      countdownSeconds: modalMode === "restraint" ? cSec : (existing.countdownSeconds || 15),
      schedule: {
        days: selectedDays,
        startTime: optModalStartTime.value || "",
        endTime: optModalEndTime.value || "",
      },
      createdAt: existing.createdAt || todayStr(),
    };

    await saveSites(sites);
    closeModal();
    renderAll();
  });

  // Sync Toggle
  if (optSyncToggle) {
    optSyncToggle.addEventListener("change", async () => {
      const desired = optSyncToggle.checked ? "sync" : "local";
      const previous = desired === "sync" ? "local" : "sync";
      optSyncToggle.disabled = true;

      try {
        const currentSites = await getSites();
        await setStoragePreference(desired);
        await saveSites(currentSites);
        storagePref = desired;
      } catch {
        optSyncToggle.checked = previous === "sync";
        await setStoragePreference(previous);
        storagePref = previous;
      } finally {
        optSyncToggle.disabled = false;
        renderAll();
      }
    });
  }

  // Export / Import / Reset
  if (optExportBtn) {
    optExportBtn.addEventListener("click", async () => {
      const payload = {
        app: "stoic-site-limiter",
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        storagePreference: storagePref,
        sites,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stoic-settings-${todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  if (optImportBtn && optImportFile) {
    optImportBtn.addEventListener("click", () => optImportFile.click());
    optImportFile.addEventListener("change", async () => {
      const file = optImportFile.files[0];
      optImportFile.value = "";
      if (!file) return;

      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        if (!payload || typeof payload.sites !== "object" || Array.isArray(payload.sites)) {
          throw new Error("Invalid Stoic backup file format.");
        }

        await saveSites(payload.sites);
        sites = payload.sites;
        renderAll();
      } catch (err) {
        if (optImportNote) {
          optImportNote.textContent = err.message || "Failed to import file.";
          optImportNote.className = "settings-note error";
          optImportNote.hidden = false;
        }
      }
    });
  }

  if (optResetAllBtn) {
    optResetAllBtn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to delete ALL site disciplines and clear usage history? This cannot be undone.")) {
        sites = {};
        await saveSites(sites);
        renderAll();
      }
    });
  }

  // ===== YouTube & Classification Debugger Inspector & AI Settings =====
  const refreshDebugBtn = document.getElementById("refreshDebugBtn");
  const addChannelBtn = document.getElementById("addChannelBtn");
  const resetChannelDbBtn = document.getElementById("resetChannelDbBtn");

  const aiSettingsForm = document.getElementById("aiSettingsForm");
  const aiProviderSelect = document.getElementById("aiProviderSelect");
  const customApiFieldsGroup = document.getElementById("customApiFieldsGroup");
  const aiApiKey = document.getElementById("aiApiKey");
  const aiApiEndpoint = document.getElementById("aiApiEndpoint");
  const aiConfidenceThreshold = document.getElementById("aiConfidenceThreshold");
  const aiConfidenceVal = document.getElementById("aiConfidenceVal");
  const aiAutoClassifyToggle = document.getElementById("aiAutoClassifyToggle");
  const aiSettingsNote = document.getElementById("aiSettingsNote");

  async function loadAndRenderAISettings() {
    if (!aiSettingsForm) return;
    const settings = await getAISettings();
    if (aiProviderSelect) aiProviderSelect.value = settings.provider || "heuristic";
    if (aiApiKey) aiApiKey.value = settings.apiKey || "";
    if (aiApiEndpoint) aiApiEndpoint.value = settings.apiEndpoint || "";
    if (aiConfidenceThreshold) {
      aiConfidenceThreshold.value = settings.confidenceThreshold !== undefined ? settings.confidenceThreshold : 0.70;
      if (aiConfidenceVal) aiConfidenceVal.textContent = `${Math.round(aiConfidenceThreshold.value * 100)}%`;
    }
    if (aiAutoClassifyToggle) aiAutoClassifyToggle.checked = settings.autoClassify !== false;

    if (customApiFieldsGroup) {
      customApiFieldsGroup.style.display = aiProviderSelect.value === "custom_api" ? "grid" : "none";
    }
  }

  if (aiProviderSelect) {
    aiProviderSelect.addEventListener("change", () => {
      if (customApiFieldsGroup) {
        customApiFieldsGroup.style.display = aiProviderSelect.value === "custom_api" ? "grid" : "none";
      }
    });
  }

  if (aiConfidenceThreshold) {
    aiConfidenceThreshold.addEventListener("input", () => {
      if (aiConfidenceVal) {
        aiConfidenceVal.textContent = `${Math.round(aiConfidenceThreshold.value * 100)}%`;
      }
    });
  }

  if (aiSettingsForm) {
    aiSettingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const updated = {
        provider: aiProviderSelect ? aiProviderSelect.value : "heuristic",
        apiKey: aiApiKey ? aiApiKey.value.trim() : "",
        apiEndpoint: aiApiEndpoint ? aiApiEndpoint.value.trim() : "",
        confidenceThreshold: aiConfidenceThreshold ? parseFloat(aiConfidenceThreshold.value) : 0.70,
        autoClassify: aiAutoClassifyToggle ? aiAutoClassifyToggle.checked : true,
      };
      await saveAISettings(updated);

      if (aiSettingsNote) {
        aiSettingsNote.textContent = "AI Settings saved successfully!";
        aiSettingsNote.className = "settings-note success";
        aiSettingsNote.style.display = "inline";
        setTimeout(() => {
          aiSettingsNote.style.display = "none";
        }, 3000);
      }
    });
  }

  if (refreshDebugBtn) {
    refreshDebugBtn.addEventListener("click", () => renderYouTubeDebugTab());
  }

  if (resetChannelDbBtn) {
    resetChannelDbBtn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to clear all YouTube channel classifications?")) {
        await saveChannelDatabase({});
        renderYouTubeDebugTab();
      }
    });
  }

  if (addChannelBtn) {
    addChannelBtn.addEventListener("click", async () => {
      const channelQuery = prompt("Enter YouTube Channel Name or Channel ID (e.g. Veritasium or UC12345):");
      if (!channelQuery || !channelQuery.trim()) return;

      const microCategory = prompt("Enter Classification Micro Category for this channel (e.g. Study, Coding, Streaming, Gaming, News):", "Study");
      if (!microCategory || !microCategory.trim()) return;

      const macroCategory = MICRO_TO_MACRO[microCategory.trim()] || "Productivity";

      await saveChannel({
        channelId: channelQuery.trim(),
        channelName: channelQuery.trim(),
        classification: { macro: macroCategory, micro: microCategory.trim() },
        confidence: 1.0,
        reason: "Manual addition via Stoic Debugger",
        source: "manual",
      });

      renderYouTubeDebugTab();
    });
  }

  async function renderYouTubeDebugTab() {
    await loadAndRenderAISettings();
    // 1. Live Debug Inspector
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const info = await chrome.runtime.sendMessage({ type: "GET_CLASSIFICATION_DEBUG_INFO" });
        if (info) {
          const optDbgVideoId = document.getElementById("optDbgVideoId");
          const optDbgTitle = document.getElementById("optDbgTitle");
          const optDbgChannel = document.getElementById("optDbgChannel");
          const optDbgContentType = document.getElementById("optDbgContentType");
          const optDbgChannelLookup = document.getElementById("optDbgChannelLookup");
          const optDbgCacheStatus = document.getElementById("optDbgCacheStatus");
          const optDbgSource = document.getElementById("optDbgSource");
          const optDbgConfidence = document.getElementById("optDbgConfidence");

          if (optDbgVideoId) optDbgVideoId.textContent = info.metadata?.videoId || "--";
          if (optDbgTitle) optDbgTitle.textContent = info.metadata?.title || "--";
          if (optDbgChannel) optDbgChannel.textContent = info.metadata?.channelName || info.metadata?.channelId || "--";
          if (optDbgContentType) optDbgContentType.textContent = info.metadata?.contentType || "video";

          if (optDbgChannelLookup) {
            if (info.channelLookup?.hit) {
              const cls = info.channelLookup.channel?.classification;
              optDbgChannelLookup.textContent = `HIT (${cls ? `${cls.macro}·${cls.micro}` : "Found"})`;
              optDbgChannelLookup.style.color = "var(--sem-green)";
            } else {
              optDbgChannelLookup.textContent = "MISS (Domain Fallback)";
              optDbgChannelLookup.style.color = "var(--text-muted)";
            }
          }

          if (optDbgCacheStatus) optDbgCacheStatus.textContent = info.cacheStatus || "MISS";
          if (optDbgSource) optDbgSource.textContent = info.classification?.source || "domain_rule";
          if (optDbgConfidence) {
            const conf = Math.round((info.classification?.confidence || 0.8) * 100);
            optDbgConfidence.textContent = `${conf}%`;
          }
        }
      } catch {
        /* Ignore background connection errors */
      }
    }

    // 2. Channel Database (yt_channels) Table
    const channelsTableBody = document.getElementById("channelsTableBody");
    if (channelsTableBody) {
      channelsTableBody.innerHTML = "";
      const channels = await getChannelDatabase();
      const channelKeys = Object.keys(channels);

      if (channelKeys.length === 0) {
        channelsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-faint); padding: 16px;">No channel classifications saved yet in Channel Database. Click "+ Add / Classify Channel" above.</td></tr>`;
      } else {
        const uniqueChannels = new Map();
        Object.values(channels).forEach((c) => {
          if (c && c.channelId) uniqueChannels.set(c.channelId, c);
        });

        uniqueChannels.forEach((channel) => {
          const row = document.createElement("tr");
          const cls = channel.classification || { macro: "Leisure", micro: "Streaming" };
          const confPct = Math.round((channel.confidence || 0.9) * 100);
          const dateStr = channel.updatedAt ? new Date(channel.updatedAt).toLocaleString() : "--";

          const isAI = channel.source === "ai" || channel.source === "ai_unclassified";
          const srcBadge = isAI ? `<span class="micro-badge" style="background: rgba(2, 132, 199, 0.12); color: #0284c7; border-color: rgba(2, 132, 199, 0.25);">AI</span>` : `<span class="micro-badge" style="background: rgba(168, 85, 247, 0.12); color: #a855f7; border-color: rgba(168, 85, 247, 0.25);">MANUAL</span>`;
          const reasonText = channel.reason || (isAI ? "AI classification" : "Manual user override");

          row.innerHTML = `
            <td>
              <div style="font-weight: 700;">${channel.channelName || channel.channelId}</div>
              <div style="font-size: 11px; color: var(--text-faint); font-family: var(--mono);">${channel.channelId}</div>
            </td>
            <td>
              <span class="micro-badge">${cls.macro} · ${cls.micro}</span>
            </td>
            <td>
              <div>${srcBadge}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; max-width: 220px; word-break: break-word;">${reasonText}</div>
            </td>
            <td>
              <span style="font-family: var(--mono); font-weight: 700;">${confPct}%</span>
            </td>
            <td style="font-size: 11.5px; color: var(--text-muted);">${dateStr}</td>
            <td>
              <button class="btn-ghost reclass-ch-btn" type="button" style="padding: 4px 8px; font-size: 11px;" title="Reclassify channel via AI">AI Reclassify</button>
              <button class="btn-ghost edit-ch-btn" type="button" style="padding: 4px 8px; font-size: 11px;" title="Manually override channel category">Override</button>
              <button class="btn-ghost del-ch-btn" type="button" style="padding: 4px 8px; font-size: 11px; color: var(--sem-red);" title="Reset/Delete channel classification">Reset</button>
            </td>
          `;

          const reclassBtn = row.querySelector(".reclass-ch-btn");
          if (reclassBtn) {
            reclassBtn.addEventListener("click", async () => {
              reclassBtn.textContent = "Classifying...";
              reclassBtn.disabled = true;
              try {
                await classifyUnknownChannel({ channelId: channel.channelId, channelName: channel.channelName }, { forceReclassify: true });
                renderYouTubeDebugTab();
              } catch (err) {
                alert("Reclassification failed: " + err.message);
              } finally {
                reclassBtn.disabled = false;
                reclassBtn.textContent = "AI Reclassify";
              }
            });
          }

          const editBtn = row.querySelector(".edit-ch-btn");
          if (editBtn) {
            editBtn.addEventListener("click", async () => {
              const newMicro = prompt(`Enter manual micro category for ${channel.channelName || channel.channelId}:`, cls.micro);
              if (!newMicro || !newMicro.trim()) return;
              const newMacro = MICRO_TO_MACRO[newMicro.trim()] || "Productivity";
              await saveChannel({
                ...channel,
                classification: { macro: newMacro, micro: newMicro.trim() },
                confidence: 1.0,
                reason: "Manual user override in Stoic Debugger",
                source: "manual",
                updatedAt: new Date().toISOString(),
              });
              renderYouTubeDebugTab();
            });
          }

          const delBtn = row.querySelector(".del-ch-btn");
          if (delBtn) {
            delBtn.addEventListener("click", async () => {
              if (confirm(`Remove ${channel.channelName || channel.channelId} from Channel Database?`)) {
                const db = await getChannelDatabase();
                delete db[channel.channelId];
                if (channel.channelName) delete db[channel.channelName];
                await saveChannelDatabase(db);
                renderYouTubeDebugTab();
              }
            });
          }

          channelsTableBody.appendChild(row);
        });
      }
    }

    // 3. Video Database (yt_videos) Table
    const videosTableBody = document.getElementById("videosTableBody");
    if (videosTableBody) {
      videosTableBody.innerHTML = "";
      const videos = await getVideoDatabase();
      const videoList = Object.values(videos).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 15);

      if (videoList.length === 0) {
        videosTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-faint); padding: 16px;">No video metadata extracted yet. Visit YouTube to see extracted videos here.</td></tr>`;
      } else {
        videoList.forEach((v) => {
          const row = document.createElement("tr");
          const dateStr = v.updatedAt ? new Date(v.updatedAt).toLocaleTimeString() : "--";
          row.innerHTML = `
            <td style="font-family: var(--mono); font-weight: 700; font-size: 11.5px;">${v.videoId}</td>
            <td style="font-weight: 600; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${v.title || "--"}</td>
            <td>${v.channelName || v.channelId || "--"}</td>
            <td><span class="micro-badge">${v.contentType || "video"}</span></td>
            <td style="font-size: 11.5px; color: var(--text-muted);">${dateStr}</td>
          `;
          videosTableBody.appendChild(row);
        });
      }
    }
  }

  // Include in tab navigation and periodic refresh
  const origRenderAll = renderAll;
  renderAll = function() {
    if (typeof origRenderAll === "function") origRenderAll();
    renderYouTubeDebugTab();
  };

  loadData();
  renderYouTubeDebugTab();
});

