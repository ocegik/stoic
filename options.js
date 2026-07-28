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

  // Friction Gate refs — the same wait/puzzle/reason challenge the
  // restraint interstitial uses, applied here so Settings can never be an
  // easier way to loosen or remove a rule than the blocked page is.
  const fgModal = document.getElementById("frictionGateModal");
  const fgTitle = document.getElementById("fgTitle");
  const fgCopy = document.getElementById("fgCopy");
  const fgWaitBar = document.getElementById("fgWaitBar");
  const fgWaitVal = document.getElementById("fgWaitVal");
  const fgPuzzleQuestion = document.getElementById("fgPuzzleQuestion");
  const fgPuzzleInput = document.getElementById("fgPuzzleInput");
  const fgPuzzleCheckBtn = document.getElementById("fgPuzzleCheckBtn");
  const fgPuzzleProgress = document.getElementById("fgPuzzleProgress");
  const fgPuzzleErr = document.getElementById("fgPuzzleErr");
  const fgReasonInput = document.getElementById("fgReasonInput");
  const fgReasonErr = document.getElementById("fgReasonErr");
  const fgConfirmCheck = document.getElementById("fgConfirmCheck");
  const fgConfirmBtn = document.getElementById("fgConfirmBtn");
  const fgCancelBtn = document.getElementById("fgCancelBtn");
  const fgCloseBtn = document.getElementById("fgCloseBtn");

  // Runs the full friction gate and resolves true only if the user makes
  // it through the wait, the puzzle streak, a genuine written reason, and
  // an explicit final confirmation. Resolves false on cancel.
  function requestFrictionGate({ title, copy }) {
    return new Promise((resolve) => {
      if (!fgModal) {
        resolve(true);
        return;
      }

      fgTitle.textContent = title || "Are you sure?";
      fgCopy.textContent = copy || "This loosens a restriction you set up on purpose.";
      fgConfirmCheck.checked = false;
      fgReasonInput.value = "";
      fgReasonErr.style.display = "none";
      fgPuzzleErr.style.display = "none";
      fgConfirmBtn.disabled = true;

      const state = { waitDone: false, puzzleDone: false, reasonDone: false };
      let streak = 0;
      let currentPuzzle = generateHardPuzzle();
      let remaining = RESTRAINT_WAIT_SECONDS;
      let waitTimer = null;
      let settled = false;

      function updateConfirmEnabled() {
        fgConfirmBtn.disabled = !(state.waitDone && state.puzzleDone && state.reasonDone && fgConfirmCheck.checked);
      }

      function renderPuzzle() {
        fgPuzzleQuestion.textContent = currentPuzzle.question;
        fgPuzzleProgress.innerHTML = Array.from({ length: RESTRAINT_PUZZLE_STREAK_REQUIRED })
          .map((_, i) => `<span class="gate-dot ${i < streak ? "gate-dot-filled" : ""}"></span>`)
          .join("");
      }

      function checkPuzzle() {
        const val = Number(fgPuzzleInput.value);
        if (fgPuzzleInput.value.trim() !== "" && val === currentPuzzle.answer) {
          streak++;
          fgPuzzleErr.style.display = "none";
          if (streak >= RESTRAINT_PUZZLE_STREAK_REQUIRED) {
            state.puzzleDone = true;
            fgPuzzleInput.disabled = true;
            renderPuzzle();
            updateConfirmEnabled();
            return;
          }
        } else {
          streak = 0;
          fgPuzzleErr.style.display = "block";
        }
        currentPuzzle = generateHardPuzzle();
        renderPuzzle();
        fgPuzzleInput.value = "";
        fgPuzzleInput.focus();
      }

      function checkReason() {
        const result = validateOpenReason(fgReasonInput.value);
        state.reasonDone = result.valid;
        fgReasonErr.style.display = result.valid ? "none" : "block";
        fgReasonErr.textContent = result.message;
        updateConfirmEnabled();
      }

      function tickWait() {
        remaining--;
        fgWaitVal.textContent = `${Math.max(0, remaining)}s`;
        fgWaitBar.style.width = `${Math.round(((RESTRAINT_WAIT_SECONDS - remaining) / RESTRAINT_WAIT_SECONDS) * 100)}%`;
        if (remaining <= 0) {
          clearInterval(waitTimer);
          state.waitDone = true;
          updateConfirmEnabled();
        }
      }

      function cleanup() {
        clearInterval(waitTimer);
        fgPuzzleInput.removeEventListener("keydown", onPuzzleKeydown);
        fgPuzzleCheckBtn.removeEventListener("click", checkPuzzle);
        fgReasonInput.removeEventListener("input", checkReason);
        fgConfirmCheck.removeEventListener("change", updateConfirmEnabled);
        fgConfirmBtn.removeEventListener("click", onConfirm);
        fgCancelBtn.removeEventListener("click", onCancel);
        fgCloseBtn.removeEventListener("click", onCancel);
        fgPuzzleInput.disabled = false;
      }

      function settle(result) {
        if (settled) return;
        settled = true;
        cleanup();
        fgModal.close();
        resolve(result);
      }

      function onConfirm() {
        if (fgConfirmBtn.disabled) return;
        settle(true);
      }
      function onCancel() {
        settle(false);
      }
      function onPuzzleKeydown(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          checkPuzzle();
        }
      }

      fgWaitVal.textContent = `${remaining}s`;
      fgWaitBar.style.width = "0%";
      renderPuzzle();
      fgPuzzleInput.disabled = false;
      fgPuzzleInput.value = "";

      waitTimer = setInterval(tickWait, 1000);
      fgPuzzleInput.addEventListener("keydown", onPuzzleKeydown);
      fgPuzzleCheckBtn.addEventListener("click", checkPuzzle);
      fgReasonInput.addEventListener("input", checkReason);
      fgConfirmCheck.addEventListener("change", updateConfirmEnabled);
      fgConfirmBtn.addEventListener("click", onConfirm);
      fgCancelBtn.addEventListener("click", onCancel);
      fgCloseBtn.addEventListener("click", onCancel);

      fgModal.showModal();
    });
  }

  const MODE_STRICTNESS = { unconstrained: 0, limit: 1, restraint: 2, block: 3 };

  // True when saving newEntry over oldEntry would reduce the friction the
  // user previously set up — a weaker mode, a longer daily limit, or a
  // narrower schedule. Used to decide whether an edit needs the gate.
  function isLoosening(oldEntry, newEntry) {
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

    return false;
  }

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
    // Classification is synchronous, so the YouTube stores must be in
    // memory before anything renders analytics off them.
    await ensureYouTubeStoresLoaded();
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
    // The debugger tab reads the same `sites` snapshot as everything above,
    // so it re-renders here rather than through the wrapper-reassignment
    // trick this file used to use.
    renderYouTubeDebugTab().catch((err) =>
      console.error("[Stoic] YouTube debugger render failed", err)
    );
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

  async function applyDomainCategory(domain, micro, macro) {
    const currentSites = await getSites();
    if (!currentSites[domain]) {
      currentSites[domain] = { mode: "unconstrained" };
    }
    // microCategory/macroCategory are the stored pair; the legacy
    // `category` field is still *read* for old profiles but no longer
    // written, so there is only one place holding this state.
    currentSites[domain].microCategory = micro;
    currentSites[domain].macroCategory = macro;
    delete currentSites[domain].category;
    await saveSites(currentSites);
    invalidateClassificationCache();
    sites = currentSites;
    renderAll();
  }

  function renderAuditTable(browsing) {
    if (!optDomainAuditTable) return;
    optDomainAuditTable.innerHTML = "";

    if (!browsing.topWebsites || browsing.topWebsites.length === 0) {
      optDomainAuditTable.innerHTML = `<div style="font-size:12px; color:var(--text-faint); padding:16px;">No website activity recorded today yet. Visit websites to view real-time session tracking!</div>`;
      return;
    }

    let html = `
      <table class="table">
        <thead>
          <tr>
            <th>Website</th>
            <th>Hierarchy (Macro & Micro)</th>
            <th>Tracked Today</th>
            <th>Status & Moderation</th>
            <th style="text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    // Derived from the taxonomy in common.js rather than duplicated here,
    // so adding a category in one place is enough.
    const taxonomyGroups = selectableMicrosByMacro();

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
        statusBadge = `<span style="padding:3px 8px; border-radius:6px; font-size:10px; font-weight:700; background:rgba(2, 132, 199, 0.12); color:#0284c7; border:1px solid rgba(2, 132, 199, 0.25);">RESTRAINT</span>`;
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
        <tr>
          <td style="font-weight:700;" title="${item.domain}">${displayName}</td>
          <td>${catSelectHtml}</td>
          <td>
            <div style="font-weight:700; font-family:var(--mono); color:var(--text-primary);">${fmtDuration(item.seconds)}</div>
            <div style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">${item.pctOfTotal}% of session</div>
          </td>
          <td>${statusBadge}</td>
          <td style="text-align:right;">
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
        const selectedMicro = e.target.value;

        if (selectedMicro === "__custom__") {
          openCustomCategoryModal(domain);
          return;
        }

        await applyDomainCategory(domain, selectedMicro, MICRO_TO_MACRO[selectedMicro] || "General");
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
        else if (isRestraint) ruleText = "60s wait + puzzle + written reason";

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
          const pausing = !entry.paused;
          if (pausing) {
            const proceed = await requestFrictionGate({
              title: `Pause restriction on ${displayName}?`,
              copy: "Pausing turns this rule off just as completely as deleting it would, for as long as you leave it paused. Same gate applies.",
            });
            if (!proceed) return;
          }
          entry.paused = pausing;
          await saveSites(sites);
          renderAll();
        });
        card.querySelector(".delete-btn").addEventListener("click", async () => {
          const proceed = await requestFrictionGate({
            title: `Remove moderation rule for ${displayName}?`,
            copy: `You installed this rule for a reason. Deleting it removes ${displayName} from Stoic entirely — no limit, no restraint, no block.`,
          });
          if (!proceed) return;
          delete sites[domain];
          await saveSites(sites);
          renderAll();
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
    const existing = sites[rawDomain] || {};

    const updatedEntry = {
      ...existing,
      mode: modalMode,
      limitMinutes: modalMode === "limit" ? limitMin : 0,
      schedule: {
        days: selectedDays,
        startTime: optModalStartTime.value || "",
        endTime: optModalEndTime.value || "",
      },
      createdAt: existing.createdAt || todayStr(),
    };

    if (isLoosening(existing, updatedEntry)) {
      const proceed = await requestFrictionGate({
        title: `Loosen the rule for ${getDomainDisplayName(rawDomain)}?`,
        copy: "You're about to reduce a restriction you set up on purpose. If it still matters, it'll survive one minute of thinking about it.",
      });
      if (!proceed) return;
    }

    sites[rawDomain] = updatedEntry;

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

        const wouldLoosen = Object.keys(sites).some((domain) => {
          const oldEntry = sites[domain];
          if (!oldEntry || (oldEntry.mode !== "restraint" && oldEntry.mode !== "block")) return false;
          const newEntry = payload.sites[domain] || { mode: "unconstrained" };
          return isLoosening(oldEntry, newEntry) || (!oldEntry.paused && newEntry.paused);
        });

        if (wouldLoosen) {
          const proceed = await requestFrictionGate({
            title: "This import will loosen existing rules",
            copy: "The file you picked would remove or weaken at least one restraint or block you already have set up. Importing it does the same thing deleting those rules would.",
          });
          if (!proceed) return;
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
      const proceed = await requestFrictionGate({
        title: "Delete every rule and all usage history?",
        copy: "This is the single biggest escape hatch in the extension — every limit, restraint, and block you've set up, gone at once, along with your history. This cannot be undone.",
      });
      if (proceed) {
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

  // ---- Channel / video classification modal ----
  // Replaces the old chain of window.prompt() calls, which accepted any
  // free-text micro category and silently defaulted its macro — so a typo
  // classified a channel as Productive.
  const ytClassifyModal = document.getElementById("ytClassifyModal");
  const ytClassifyForm = document.getElementById("ytClassifyForm");
  const ytClassifyTitle = document.getElementById("ytClassifyTitle");
  const ytClassifySubject = document.getElementById("ytClassifySubject");
  const ytClassifyError = document.getElementById("ytClassifyError");
  const ytClassifyHint = document.getElementById("ytClassifyHint");
  const ytClassifyMacroSeg = document.getElementById("ytClassifyMacroSeg");
  const ytClassifyMicro = document.getElementById("ytClassifyMicro");
  const ytClassifyCloseBtn = document.getElementById("ytClassifyCloseBtn");
  const ytClassifyCancelBtn = document.getElementById("ytClassifyCancelBtn");

  // { kind: "channel" | "video", channelId, channelName, videoId }
  let ytClassifyTarget = null;
  let ytClassifyMacro = "General";

  function fillMicroOptions(macro, selected) {
    if (!ytClassifyMicro) return;
    const groups = selectableMicrosByMacro();
    const micros = groups[macro] || [];
    ytClassifyMicro.innerHTML = micros
      .map((m) => `<option value="${m}" ${m === selected ? "selected" : ""}>${m}</option>`)
      .join("");
    if (selected && !micros.includes(selected)) {
      ytClassifyMicro.insertAdjacentHTML(
        "beforeend",
        `<option value="${selected}" selected>${selected} (custom)</option>`
      );
    }
  }

  function setClassifyMacro(macro, selectedMicro) {
    ytClassifyMacro = MACRO_ORDER.includes(macro) ? macro : "General";
    if (ytClassifyMacroSeg) {
      ytClassifyMacroSeg.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-value") === ytClassifyMacro);
      });
    }
    fillMicroOptions(ytClassifyMacro, selectedMicro);
  }

  wireSegmented(ytClassifyMacroSeg, (val) => setClassifyMacro(val));

  function openClassifyModal(target) {
    if (!ytClassifyModal) return;
    ytClassifyTarget = target;
    ytClassifyError.style.display = "none";
    ytClassifyError.textContent = "";

    if (target.kind === "video") {
      ytClassifyTitle.textContent = "Classify Video";
      ytClassifySubject.value = target.label || target.videoId;
      ytClassifySubject.disabled = true;
      ytClassifyHint.textContent =
        "A video override applies to this one video only and outranks its channel's classification.";
    } else {
      ytClassifyTitle.textContent = target.channelId || target.channelName ? "Classify Channel" : "Add Channel";
      ytClassifySubject.value = target.label || target.channelName || target.channelId || "";
      ytClassifySubject.disabled = !!(target.channelId || target.channelName);
      ytClassifyHint.textContent =
        "An explicit classification is permanent: this channel always resolves to the category you choose, and prediction never runs for it again.";
    }

    setClassifyMacro(target.macro || "General", target.micro);
    ytClassifyModal.showModal();
  }

  function closeClassifyModal() {
    if (ytClassifyModal) ytClassifyModal.close();
    ytClassifyTarget = null;
  }

  if (ytClassifyCloseBtn) ytClassifyCloseBtn.addEventListener("click", closeClassifyModal);
  if (ytClassifyCancelBtn) ytClassifyCancelBtn.addEventListener("click", closeClassifyModal);

  if (ytClassifyForm) {
    ytClassifyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!ytClassifyTarget) return closeClassifyModal();

      const classification = { macro: ytClassifyMacro, micro: ytClassifyMicro.value };

      if (ytClassifyTarget.kind === "video") {
        await setVideoOverride(ytClassifyTarget.videoId, classification);
      } else {
        const typed = ytClassifySubject.value.trim();
        const channelId = ytClassifyTarget.channelId || (/^UC[\w-]{6,}$/i.test(typed) ? typed : null);
        const channelName = ytClassifyTarget.channelName || (channelId ? null : typed);
        if (!channelId && !channelName) {
          ytClassifyError.textContent = "Enter a channel name or channel ID.";
          ytClassifyError.style.display = "block";
          return;
        }
        await setChannelClassification({ channelId, channelName }, classification);
      }

      closeClassifyModal();
      // A manual classification is authoritative everywhere, so re-render
      // the analytics surfaces too, not just this tab.
      await loadData();
    });
  }

  // ---- Custom micro category modal (audit table "+ Custom Micro Category...") ----
  // Replaces the old chain of window.prompt() calls, which accepted any
  // free-text macro and silently defaulted it, same failure mode as the
  // YouTube classify prompts above.
  const customCategoryModal = document.getElementById("customCategoryModal");
  const customCategoryForm = document.getElementById("customCategoryForm");
  const customCategoryName = document.getElementById("customCategoryName");
  const customCategoryError = document.getElementById("customCategoryError");
  const customCategoryMacroSeg = document.getElementById("customCategoryMacroSeg");
  const customCategoryCloseBtn = document.getElementById("customCategoryCloseBtn");
  const customCategoryCancelBtn = document.getElementById("customCategoryCancelBtn");

  let customCategoryDomain = null;
  let customCategoryMacro = "General";

  wireSegmented(customCategoryMacroSeg, (val) => {
    customCategoryMacro = MACRO_ORDER.includes(val) ? val : "General";
  });

  function openCustomCategoryModal(domain) {
    if (!customCategoryModal) return;
    customCategoryDomain = domain;
    customCategoryMacro = "General";
    customCategoryName.value = "";
    customCategoryError.style.display = "none";
    customCategoryError.textContent = "";
    if (customCategoryMacroSeg) {
      customCategoryMacroSeg.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-value") === "General");
      });
    }
    customCategoryModal.showModal();
  }

  function closeCustomCategoryModal() {
    if (customCategoryModal) customCategoryModal.close();
    customCategoryDomain = null;
    // The select still shows "__custom__"; re-render so it reflects the
    // domain's actual stored category again.
    renderAll();
  }

  if (customCategoryCloseBtn) customCategoryCloseBtn.addEventListener("click", closeCustomCategoryModal);
  if (customCategoryCancelBtn) customCategoryCancelBtn.addEventListener("click", closeCustomCategoryModal);

  if (customCategoryForm) {
    customCategoryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!customCategoryDomain) return closeCustomCategoryModal();

      const micro = customCategoryName.value.trim();
      if (!micro) {
        customCategoryError.textContent = "Enter a category name.";
        customCategoryError.style.display = "block";
        return;
      }

      const domain = customCategoryDomain;
      customCategoryDomain = null;
      if (customCategoryModal) customCategoryModal.close();
      await applyDomainCategory(domain, micro, customCategoryMacro);
    });
  }

  if (refreshDebugBtn) {
    refreshDebugBtn.addEventListener("click", () => renderYouTubeDebugTab());
  }

  if (resetChannelDbBtn) {
    resetChannelDbBtn.addEventListener("click", async () => {
      if (confirm("Clear every YouTube channel classification, including the ones you set by hand?")) {
        await clearChannelStore();
        await loadData();
      }
    });
  }

  if (addChannelBtn) {
    addChannelBtn.addEventListener("click", () => openClassifyModal({ kind: "channel" }));
  }

  const SOURCE_BADGES = {
    manual: { label: "EXPLICIT", color: "#a855f7", tint: "rgba(168, 85, 247, 0.12)" },
    builtin: { label: "BUILT-IN", color: "#0d9488", tint: "rgba(13, 148, 136, 0.12)" },
    predicted: { label: "PREDICTED", color: "#0284c7", tint: "rgba(2, 132, 199, 0.12)" },
    unclassified: { label: "UNRESOLVED", color: "#f59e0b", tint: "rgba(245, 158, 11, 0.12)" },
  };

  function sourceBadgeHtml(source) {
    const badge = SOURCE_BADGES[source] || SOURCE_BADGES.predicted;
    return `<span class="micro-badge" style="background:${badge.tint}; color:${badge.color}; border-color:${badge.tint};">${badge.label}</span>`;
  }

  const TRACE_STEP_LABELS = {
    video_override: "1 · Explicit video override",
    explicit_channel: "2 · Explicit channel classification",
    site_override: "3 · Category set on youtube.com",
    predicted_channel: "4 · Predicted channel classification",
    predicted_video: "5 · Prediction from this video's title",
    domain_rule: "6 · Generic youtube.com rule",
  };

  const TRACE_STATUS_COLORS = {
    hit: "var(--sem-green)",
    miss: "var(--text-faint)",
    skipped: "var(--text-faint)",
    unclassified: "var(--sem-amber)",
    fallthrough: "var(--text-muted)",
  };

  function renderTrace(trace) {
    const el = document.getElementById("optDbgTrace");
    if (!el) return;
    if (!trace || trace.length === 0) {
      el.innerHTML = `<li class="debug-trace-empty">Open a YouTube tab and refresh the inspector to see how its category was decided.</li>`;
      return;
    }
    el.innerHTML = trace
      .map((step) => {
        const color = TRACE_STATUS_COLORS[step.status] || "var(--text-muted)";
        return `
          <li class="debug-trace-row">
            <span class="debug-trace-step">${TRACE_STEP_LABELS[step.step] || step.step}</span>
            <span class="debug-trace-status" style="color:${color};">${step.status.toUpperCase()}</span>
            <span class="debug-trace-detail">${step.detail ? step.detail : ""}</span>
          </li>`;
      })
      .join("");
  }

  function renderYtCategoryTotals() {
    const el = document.getElementById("optYtCategoryTotals");
    if (!el) return;
    const totals = youtubeCategoryTotals(sites, todayStr());

    if (!totals.totalSeconds) {
      el.innerHTML = `<div class="yt-totals-empty">No YouTube time tracked today yet.</div>`;
      return;
    }

    el.innerHTML = totals.segments
      .map(
        (seg) => `
        <div class="yt-total-row">
          <span class="macro-badge macro-${seg.macro.toLowerCase()}">${MACRO_CATEGORIES[seg.macro]?.label || seg.macro}</span>
          <span class="yt-total-micro">${seg.micro}</span>
          <div class="yt-total-bar"><div class="yt-total-fill" style="width:${Math.max(3, seg.pctOfTotal)}%;"></div></div>
          <span class="yt-total-time">${fmtDuration(seg.seconds)}</span>
          <span class="yt-total-pct">${seg.pctOfTotal}%</span>
        </div>`
      )
      .join("");
  }

  async function renderYouTubeDebugTab() {
    await loadAndRenderAISettings();
    await ensureYouTubeStoresLoaded();

    // 1. Live inspector for the tab currently in front of the user.
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const info = await chrome.runtime.sendMessage({ type: "GET_CLASSIFICATION_DEBUG_INFO" });
        if (info) {
          const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
          };

          setText("optDbgVideoId", info.metadata?.videoId || "--");
          setText("optDbgTitle", info.metadata?.title || "--");
          setText("optDbgChannel", info.metadata?.channelName || info.metadata?.channelId || "--");
          setText("optDbgContentType", info.metadata?.contentType || "--");
          setText("optDbgCacheStatus", info.cacheStatus || "MISS");
          setText("optDbgSource", info.classification?.source || "domain_rule");
          setText("optDbgAttribution", info.attributionKey || "--");
          setText(
            "optDbgConfidence",
            `${Math.round((info.classification?.confidence ?? 0.8) * 100)}%`
          );

          const cls = info.classification;
          setText(
            "optDbgCategory",
            cls ? `${MACRO_CATEGORIES[cls.macro]?.label || cls.macro} · ${cls.micro}` : "--"
          );

          const lookupEl = document.getElementById("optDbgChannelLookup");
          if (lookupEl) {
            if (info.channelLookup?.hit) {
              const c = info.channelLookup.channel?.classification;
              lookupEl.textContent = `HIT (${c ? `${c.macro}·${c.micro}` : "found"})`;
              lookupEl.style.color = "var(--sem-green)";
            } else {
              lookupEl.textContent = "MISS (no stored channel)";
              lookupEl.style.color = "var(--text-muted)";
            }
          }

          renderTrace(info.trace);
        }
      } catch {
        /* the service worker may be asleep; the tables below still render */
      }
    }

    // 2. Today's YouTube time by category — proof the classifications are
    //    actually reaching analytics.
    renderYtCategoryTotals();

    // 3. Channel database.
    const channelsTableBody = document.getElementById("channelsTableBody");
    if (channelsTableBody) {
      channelsTableBody.innerHTML = "";
      const channels = listChannels();

      if (channels.length === 0) {
        channelsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-faint); padding: 16px;">No channel classifications stored yet. Watch a YouTube video, or use “+ Add / Classify Channel”.</td></tr>`;
      } else {
        channels.forEach((channel) => {
          const cls = channel.classification || { macro: "General", micro: "Unclassified" };
          const row = document.createElement("tr");
          const confPct = Math.round((channel.confidence ?? 0.9) * 100);
          const dateStr = channel.updatedAt ? new Date(channel.updatedAt).toLocaleString() : "--";
          const macroLabel = MACRO_CATEGORIES[cls.macro]?.label || cls.macro;

          row.innerHTML = `
            <td>
              <div style="font-weight: 700;">${channel.channelName || channel.channelId}</div>
              <div style="font-size: 11px; color: var(--text-faint); font-family: var(--mono);">${channel.channelId}</div>
            </td>
            <td>
              <span class="macro-badge macro-${cls.macro.toLowerCase()}">${macroLabel}</span>
              <span class="micro-badge">${cls.micro}</span>
            </td>
            <td>
              <div>${sourceBadgeHtml(channel.source)}${channel.pinned ? ` <span class="micro-badge" title="Explicit classifications are final — prediction never overwrites them.">PINNED</span>` : ""}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; max-width: 240px; word-break: break-word;">${channel.reason || "--"}</div>
            </td>
            <td><span style="font-family: var(--mono); font-weight: 700;">${confPct}%</span></td>
            <td style="font-size: 11.5px; color: var(--text-muted);">${dateStr}</td>
            <td>
              <button class="btn-ghost edit-ch-btn" type="button" style="padding: 4px 8px; font-size: 11px;" title="Set this channel's category permanently">Classify</button>
              <button class="btn-ghost reclass-ch-btn" type="button" style="padding: 4px 8px; font-size: 11px;" title="Run the prediction system again for this channel">Re-predict</button>
              <button class="btn-ghost del-ch-btn" type="button" style="padding: 4px 8px; font-size: 11px; color: var(--sem-red);" title="Forget this classification and let prediction decide again">Reset</button>
            </td>
          `;

          row.querySelector(".edit-ch-btn").addEventListener("click", () =>
            openClassifyModal({
              kind: "channel",
              channelId: channel.channelId,
              channelName: channel.channelName,
              label: channel.channelName || channel.channelId,
              macro: cls.macro,
              micro: cls.micro,
            })
          );

          const reclassBtn = row.querySelector(".reclass-ch-btn");
          reclassBtn.addEventListener("click", async () => {
            reclassBtn.disabled = true;
            reclassBtn.textContent = "Predicting...";
            try {
              await predictChannelClassification(
                { channelId: channel.channelId, channelName: channel.channelName },
                { forceReclassify: true }
              );
              await loadData();
            } catch (err) {
              alert("Re-prediction failed: " + err.message);
              reclassBtn.disabled = false;
              reclassBtn.textContent = "Re-predict";
            }
          });

          row.querySelector(".del-ch-btn").addEventListener("click", async () => {
            if (confirm(`Forget the classification for ${channel.channelName || channel.channelId}?`)) {
              await unpinChannel({ channelId: channel.channelId, channelName: channel.channelName });
              await loadData();
            }
          });

          channelsTableBody.appendChild(row);
        });
      }
    }

    // 4. Video log, showing the category each video actually resolves to.
    const videosTableBody = document.getElementById("videosTableBody");
    if (videosTableBody) {
      videosTableBody.innerHTML = "";
      const videos = await getVideoDatabase();
      const videoList = Object.values(videos)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
        .slice(0, 15);

      if (videoList.length === 0) {
        videosTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-faint); padding: 16px;">No video metadata extracted yet. Visit YouTube to populate this log.</td></tr>`;
      } else {
        videoList.forEach((v) => {
          const { result } = explainYouTubeClassification(
            {
              domain: "youtube.com",
              videoId: v.videoId,
              channelId: v.channelId,
              channelName: v.channelName,
              title: v.title,
            },
            { sites }
          );
          const macroLabel = MACRO_CATEGORIES[result.macro]?.label || result.macro;
          const row = document.createElement("tr");
          row.innerHTML = `
            <td style="font-family: var(--mono); font-weight: 700; font-size: 11.5px;">${v.videoId}</td>
            <td style="font-weight: 600; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.title || ""}">${v.title || "--"}</td>
            <td>${v.channelName || v.channelId || "--"}</td>
            <td>
              <span class="macro-badge macro-${result.macro.toLowerCase()}">${macroLabel}</span>
              <span class="micro-badge">${result.micro}</span>
              <div style="font-size: 10.5px; color: var(--text-faint); margin-top: 2px;">${result.source}</div>
            </td>
            <td style="font-size: 11.5px; color: var(--text-muted);">${v.updatedAt ? new Date(v.updatedAt).toLocaleTimeString() : "--"}</td>
            <td>
              <button class="btn-ghost vid-override-btn" type="button" style="padding: 4px 8px; font-size: 11px;">Override</button>
              ${v.override ? `<button class="btn-ghost vid-clear-btn" type="button" style="padding: 4px 8px; font-size: 11px; color: var(--sem-red);">Clear</button>` : ""}
            </td>
          `;

          row.querySelector(".vid-override-btn").addEventListener("click", () =>
            openClassifyModal({
              kind: "video",
              videoId: v.videoId,
              label: v.title || v.videoId,
              macro: result.macro,
              micro: result.micro,
            })
          );

          const clearBtn = row.querySelector(".vid-clear-btn");
          if (clearBtn) {
            clearBtn.addEventListener("click", async () => {
              await setVideoOverride(v.videoId, null);
              await loadData();
            });
          }

          videosTableBody.appendChild(row);
        });
      }
    }
  }

  loadData();
});
