// ===== options.js — Stoic Analytics & Moderation Dashboard =====

document.addEventListener("DOMContentLoaded", async () => {
  // Navigation Tabs.
  //
  // The markup declares the ARIA tab pattern (role="tablist"/"tab"/"tabpanel"
  // + aria-selected), so it has to behave like one: a screen reader tells the
  // user to press the arrow keys, and previously nothing happened. That is
  // worse than plain buttons. This implements the full pattern — roving
  // tabindex, Left/Right/Home/End, and aria-controls wiring.
  const tabs = Array.from(document.querySelectorAll(".nav-tab"));
  const panels = document.querySelectorAll(".tab-panel");

  function selectTab(tab, { focus = false } = {}) {
    tabs.forEach((t) => {
      const isActive = t === tab;
      t.classList.toggle("active", isActive);
      t.setAttribute("aria-selected", isActive ? "true" : "false");
      // Only the selected tab is in the page's tab order; the arrow keys
      // move between them from there.
      t.tabIndex = isActive ? 0 : -1;
    });
    panels.forEach((p) => {
      p.classList.remove("active");
      p.hidden = true;
    });

    const targetPanel = document.getElementById(tab.getAttribute("data-target"));
    if (targetPanel) {
      targetPanel.classList.add("active");
      targetPanel.hidden = false;
    }
    if (focus) tab.focus();
  }

  tabs.forEach((tab, index) => {
    const targetId = tab.getAttribute("data-target");
    const panel = document.getElementById(targetId);
    if (panel) {
      const tabId = `${targetId}-tab`;
      tab.id = tabId;
      tab.setAttribute("aria-controls", targetId);
      panel.setAttribute("aria-labelledby", tabId);
    }
    tab.tabIndex = tab.classList.contains("active") ? 0 : -1;

    tab.addEventListener("click", () => selectTab(tab));

    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      let next = null;
      if (step) next = tabs[(index + step + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      selectTab(next, { focus: true });
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
  const optOverviewRefusals = document.getElementById("optOverviewRefusals");

  // Moderation Rules Summary Refs
  const optModLimitedCount = document.getElementById("optModLimitedCount");
  const optModTrippedCount = document.getElementById("optModTrippedCount");

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

  // Progress tab refs (progression-ui.js fills these; options.js never
  // builds progression markup itself, per 02-ARCHITECTURE.md §7).
  const progLevelUpBannerOptions = document.getElementById("progLevelUpBannerOptions");
  const progIdentityContainer = document.getElementById("progIdentityContainer");
  const progStandingContainer = document.getElementById("progStandingContainer");
  const progStreaksContainer = document.getElementById("progStreaksContainer");
  const progGridContainer = document.getElementById("progGridContainer");
  const progRecordsContainer = document.getElementById("progRecordsContainer");
  const progAchievementsContainer = document.getElementById("progAchievementsContainer");
  const progLifetimeContainer = document.getElementById("progLifetimeContainer");
  const optLeisureCeilingInput = document.getElementById("optLeisureCeilingInput");
  const optFocusTargetInput = document.getElementById("optFocusTargetInput");

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

  // Shared with the popup — see isLooseningRule in common.js. Both surfaces
  // must agree on what counts as loosening, or one of them becomes the cheap
  // way round the gate.
  const isLoosening = isLooseningRule;

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
    optModalLimitRow.hidden = val !== "limit";
    if (optModalRestraintRow) optModalRestraintRow.hidden = val !== "restraint";
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

  // Daily Standard thresholds (01-PRODUCT-DESIGN.md §7): the only two
  // progression knobs exposed to the user. Clamped here to the product's
  // fixed ranges before the event is even sent — recordEvent's
  // config_updated handler writes whatever it's given, so the clamp has to
  // happen on this side.
  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  if (optLeisureCeilingInput) {
    optLeisureCeilingInput.addEventListener("change", async () => {
      const clamped = clamp(optLeisureCeilingInput.value, 15, 240, DEFAULT_LEISURE_CEILING_MINUTES);
      optLeisureCeilingInput.value = clamped;
      await sendProgressionEvent("config_updated", { leisureCeilingMinutes: clamped });
      renderProgress().catch((err) => console.error("[Stoic] progress tab render failed", err));
    });
  }

  if (optFocusTargetInput) {
    optFocusTargetInput.addEventListener("change", async () => {
      const clamped = clamp(optFocusTargetInput.value, 40, 90, DEFAULT_FOCUS_TARGET);
      optFocusTargetInput.value = clamped;
      await sendProgressionEvent("config_updated", { focusTarget: clamped });
      renderProgress().catch((err) => console.error("[Stoic] progress tab render failed", err));
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

  // Lifetime refusals live in the progression store, not in `sites`, so this
  // is the one number on Overview that has to be fetched. It is rendered
  // out-of-band rather than making the whole synchronous render async.
  async function renderLifetimeRefusals() {
    if (!optOverviewRefusals) return;
    try {
      const prog = await loadProgression();
      optOverviewRefusals.textContent = (prog.lifetime && prog.lifetime.refusals) || 0;
    } catch {
      optOverviewRefusals.textContent = "—";
    }
  }

  // Every surface that can be empty says what would appear here and what
  // makes it appear. A blank box is not an empty state (audit §2.5).
  function emptyState(title, body) {
    return `<div class="empty-state empty-state-inline">
      <span class="empty-state-title">${title}</span>
      <span class="empty-state-body">${body}</span>
    </div>`;
  }

  // Wires the "Why was this counted as X?" affordance (audit R5) inside a
  // freshly-rendered container: a toggle button that reveals a plain-
  // language sentence, plus an inline "Classify this channel" action. Used
  // by both the domain audit table and the category breakdown — the two
  // places the old debugger's job now lives.
  function wireWhyControls(container) {
    if (!container) return;
    container.querySelectorAll(".why-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = container.querySelector(`[data-why-panel="${btn.dataset.whyFor}"]`);
        if (panel) panel.hidden = !panel.hidden;
      });
    });
    container.querySelectorAll(".why-classify-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const channelId = btn.dataset.channelId || null;
        const channelName = btn.dataset.channelName || null;
        openClassifyModal({
          kind: "channel",
          channelId,
          channelName,
          label: channelName || channelId || "",
          macro: btn.dataset.macro || "General",
          micro: btn.dataset.micro || undefined,
        });
      });
    });
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
      // Descriptive, never a verdict — and it avoids the word "restraint",
      // which the glossary reserves for the pause (docs/GLOSSARY.md §2).
      if (focusScore >= 80) {
        optFocusGaugePath.style.stroke = "var(--held)";
        if (optFocusScoreSub) optFocusScoreSub.textContent = "Mostly productive time";
      } else if (focusScore >= 50) {
        optFocusGaugePath.style.stroke = "var(--partial)";
        if (optFocusScoreSub) optFocusScoreSub.textContent = "A mixed day so far";
      } else {
        optFocusGaugePath.style.stroke = "var(--missed)";
        if (optFocusScoreSub) optFocusScoreSub.textContent = "Mostly leisure time";
      }
    }

    // 2. Overview Top Websites (Compact Ranked List: Favicon, Name, Usage Bar, Time, Percentage)
    renderOverviewTopWebsites(browsing.topWebsites);

    // 3. Overview Behaviour Summary (Compact Row: Limits Triggered, Rules Active, Time Saved)
    if (optOverviewTrippedCount) optOverviewTrippedCount.textContent = moderation.limitsTriggeredToday;
    if (optOverviewRulesActive) optOverviewRulesActive.textContent = moderation.limitedSitesCount;
    renderLifetimeRefusals();

    // 4. Detailed Analysis AI Insight
    const optInsightText = document.getElementById("optInsightText");
    if (optInsightText) optInsightText.textContent = generateQuickInsight(sites, today);

    // 5. Rules Moderation Performance Summary
    if (optModLimitedCount) optModLimitedCount.textContent = moderation.limitedSitesCount;
    if (optModTrippedCount) optModTrippedCount.textContent = moderation.limitsTriggeredToday;

    renderSyncSection();
    renderAnalytics(browsing);
    renderDisciplines(moderation);
    renderChannelsTable();
    renderProgress().catch((err) => console.error("[Stoic] progress tab render failed", err));
  }

  // Fills the Progress tab from progression-ui.js's render functions, and
  // the two Daily Standard fields on the Preferences tab. options.js never
  // builds progression markup itself — that would let this surface and
  // popup.js drift (02-ARCHITECTURE.md §7).
  async function renderProgress() {
    const prog = await loadProgression();

    if (progIdentityContainer) progIdentityContainer.innerHTML = renderLevelIdentity(prog);
    if (progStandingContainer) progStandingContainer.innerHTML = renderTodayStanding(buildLiveDayView(sites, prog));
    if (progStreaksContainer) progStreaksContainer.innerHTML = renderStreaks(prog);
    if (progGridContainer) progGridContainer.innerHTML = renderContributionGrid(prog);
    if (progRecordsContainer) progRecordsContainer.innerHTML = renderRecords(prog);
    if (progAchievementsContainer) progAchievementsContainer.innerHTML = renderAchievements(prog);
    if (progLifetimeContainer) progLifetimeContainer.innerHTML = renderLifetime(prog);

    if (progLevelUpBannerOptions) {
      progLevelUpBannerOptions.innerHTML = renderLevelUpBanner(prog);
      const dismissBtn = progLevelUpBannerOptions.querySelector(".prog-levelup-dismiss");
      if (dismissBtn) {
        dismissBtn.addEventListener("click", async () => {
          progLevelUpBannerOptions.innerHTML = "";
          await sendProgressionEvent("level_up_seen", {});
        });
      }
    }

    // Don't clobber a value the user is mid-edit on — a re-render can be
    // triggered by an unrelated rule save while this tab happens to be open.
    if (optLeisureCeilingInput && document.activeElement !== optLeisureCeilingInput) {
      optLeisureCeilingInput.value = prog.config.leisureCeilingMinutes;
    }
    if (optFocusTargetInput && document.activeElement !== optFocusTargetInput) {
      optFocusTargetInput.value = prog.config.focusTarget;
    }
  }

  function renderOverviewTopWebsites(topWebsites) {
    if (!optTopWebsitesList) return;
    optTopWebsitesList.innerHTML = "";

    if (!topWebsites || topWebsites.length === 0) {
      optTopWebsitesList.innerHTML = emptyState(
        "Nothing tracked today",
        "Sites appear here once you have spent a minute on them."
      );
      return;
    }

    const top5 = topWebsites.slice(0, 5);
    top5.forEach((item) => {
      const displayName = getDomainDisplayName(item.domain);
      const initial = (displayName.charAt(0) || "?").toUpperCase();

      const row = document.createElement("div");
      row.className = "top-site-row";
      // A monogram, not a favicon. Fetching favicons from Google would send
      // the user's most-visited domains to Google every time this page
      // renders, which is exactly the thing the product promises it doesn't do.
      row.innerHTML = `
        <div class="top-site-favicon-box">
          <span class="top-site-avatar-fallback">${initial}</span>
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

      // Seven bars all at zero is not a chart, it is a misleading blank.
      if (maxSec <= 1) {
        optAnalyticsChart.innerHTML = emptyState(
          "No week to show yet",
          "After a day or two of tracking, the last seven days appear here."
        );
      } else {
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
      optCategoryGrid.innerHTML = emptyState(
        "Nothing to break down yet",
        "Once a few minutes are tracked, this shows how the day split between productive, general and leisure time."
      );
      return;
    }

    const colorMap = {
      Productivity: "var(--held)",
      General: "var(--waived)",
      Leisure: "var(--partial)",
    };

    const today = todayStr();

    macroBreakdown.forEach((mac) => {
      const card = document.createElement("div");
      card.className = "category-card";

      const barColor = colorMap[mac.macro] || "var(--accent)";
      const microItemsHtml = mac.micros.map((m) => {
        // "Why?" only appears where YouTube actually contributed to this
        // bucket today — showing it everywhere would mean guessing at an
        // explanation for buckets nothing on YouTube touched (audit R5).
        const why = explainCategoryToday(mac.macro, m.micro, sites, today);
        const whyKey = `${mac.macro}|${m.micro}`;
        return `
        <div class="micro-item-row">
          <span class="micro-item-name">${m.micro}</span>
          <span class="micro-item-time">${fmtDuration(m.seconds)} (${m.pctOfMacro}% of ${mac.macro.toLowerCase()})</span>
          ${why ? `<button class="btn-ghost btn-compact why-toggle-btn" type="button" data-why-for="${whyKey}">Why?</button>` : ""}
        </div>
        ${why ? `
          <div class="why-panel" data-why-panel="${whyKey}" hidden>
            <p class="why-sentence">${why.sentence}</p>
            <button class="btn-ghost btn-compact why-classify-btn" type="button" data-channel-id="${why.channelId || ""}" data-channel-name="${why.channelName || ""}" data-macro="${mac.macro}" data-micro="${m.micro}">Classify this channel</button>
          </div>
        ` : ""}`;
      }).join("");

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

    wireWhyControls(optCategoryGrid);
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
      optDomainAuditTable.innerHTML = emptyState(
        "Nothing tracked today",
        "Every site you spend a minute on appears here, with the option to put a rule on it."
      );
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
    const today = todayStr();

    browsing.topWebsites.forEach((item) => {
      const displayName = getDomainDisplayName(item.domain);
      const { macro, micro } = item.taxonomy || getDomainTaxonomy(item.domain, sites);

      const badge = (label, bg, fg, bd) =>
        `<span class="rule-badge" style="background:${bg}; color:${fg}; border-color:${bd};">${label}</span>`;

      let statusBadge = badge("No rule", "transparent", "var(--text-faint)", "var(--border-soft)");
      if (item.paused) {
        statusBadge = badge("Paused", "var(--bg-raised)", "var(--text-faint)", "var(--border-soft)");
      } else if (item.mode === "limit") {
        statusBadge = badge(`${item.entry.limitMinutes || 30}m a day`, "var(--partial-dim)", "var(--partial-soft)", "var(--partial-border)");
      } else if (item.mode === "block") {
        statusBadge = badge("Always closed", "var(--missed-dim)", "var(--missed-soft)", "var(--missed-border)");
      } else if (item.mode === "restraint") {
        statusBadge = badge("Pause first", "var(--waived-dim)", "var(--waived-soft)", "var(--waived-border)");
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

      // The debugger's replacement (audit R5): a one-sentence "why" for
      // YouTube rows only — every other domain's category is exactly what
      // it says on the tin, with nothing to explain.
      const isYouTubeRow = isYouTubeDomain(item.domain);
      const why = isYouTubeRow ? explainDomainToday(item.domain, sites, today) : null;

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
            ${why ? `<button class="btn-ghost btn-compact why-toggle-btn" type="button" data-why-for="${item.domain}">Why?</button>` : ""}
            <button class="btn-ghost audit-action-btn" data-domain="${item.domain}" style="padding:5px 10px; font-size:11px; font-weight:600;">
              ${item.mode === "unconstrained" ? "+ Limit" : "Edit Rule"}
            </button>
          </td>
        </tr>
        ${why ? `
          <tr class="why-panel-row" data-why-panel="${item.domain}" hidden>
            <td colspan="5">
              <div class="why-panel">
                <p class="why-sentence">${why.sentence}</p>
                <button class="btn-ghost btn-compact why-classify-btn" type="button" data-channel-id="${why.channelId || ""}" data-channel-name="${why.channelName || ""}" data-macro="${why.macro}" data-micro="${why.micro}">Classify this channel</button>
              </div>
            </td>
          </tr>
        ` : ""}
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

    wireWhyControls(optDomainAuditTable);

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

        let progressColor = "var(--held)";
        if (usedPct >= 100) progressColor = "var(--missed)";
        else if (usedPct >= 75) progressColor = "var(--partial)";
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
          await sendProgressionEvent("rule_deleted", { domain });
          renderAll();
        });

        optDisciplinesGrid.appendChild(card);
      });
    }

    // Streaks List
    if (optStreaksList) {
      optStreaksList.innerHTML = "";
      if (keys.length === 0) {
        optStreaksList.innerHTML = emptyState(
          "No rules yet",
          "Rules you set will appear here with how many days in a row you have kept each one."
        );
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
    optModalLimitRow.hidden = modalMode !== "limit";
    if (optModalRestraintRow) optModalRestraintRow.hidden = modalMode !== "restraint";

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

    const loosening = isLoosening(existing, updatedEntry);
    if (loosening) {
      const proceed = await requestFrictionGate({
        title: `Loosen the rule for ${getDomainDisplayName(rawDomain)}?`,
        copy: "You're about to reduce a restriction you set up on purpose. If it still matters, it'll survive one minute of thinking about it.",
      });
      if (!proceed) return;
    }

    // A rule is "created" the moment a domain goes from no real rule
    // (absent, or the auto-created `unconstrained` entry every visited
    // domain gets) to one that actually governs it — never on an edit that
    // keeps governing it (01-PRODUCT-DESIGN.md §3.10: no XP for
    // configuration work, but the origin achievement still needs the event).
    const hadRule = entryHasRule(existing);
    const hasRuleNow = entryHasRule(updatedEntry);

    sites[rawDomain] = updatedEntry;

    await saveSites(sites);
    if (!hadRule && hasRuleNow) {
      await sendProgressionEvent("rule_created", { domain: rawDomain });
    } else if (loosening) {
      await sendProgressionEvent("rule_loosened", { domain: rawDomain });
    }
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
        progression: await loadProgression(),
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

        // Never merge two progression states — replace the ledger wholesale
        // or skip it entirely (03-IMPLEMENTATION-SPEC.md §6.2). A backup
        // from before this feature shipped simply has no `progression` key,
        // which is the common case and not worth a note. A version newer
        // than this build understands is the only case worth telling the
        // user about, since silently skipping it could look like data loss.
        let progressionNote = "";
        if (payload.progression && typeof payload.progression.version === "number") {
          if (payload.progression.version <= PROGRESSION_SCHEMA_VERSION) {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ type: "RESTORE_PROGRESSION", state: payload.progression }, () => {
                if (chrome.runtime.lastError) {
                  /* ignore — no receiving end */
                }
                resolve();
              });
            });
          } else {
            progressionNote = " Progress data in this file is from a newer version of Stoic and was left untouched.";
          }
        }

        renderAll();
        if (progressionNote && optImportNote) {
          optImportNote.textContent = `Backup imported.${progressionNote}`;
          optImportNote.className = "settings-note";
          optImportNote.hidden = false;
        }
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

  // ===== What counts as what on YouTube (Rules tab) =====
  // What's left of the old debugger tab: the channel classification table
  // only. The live inspector, precedence trace and AI settings card are
  // gone (audit R4/R5) — see docs/audit/PRODUCT-AUDIT.md Part 5.5.
  const addChannelBtn = document.getElementById("addChannelBtn");
  const resetChannelDbBtn = document.getElementById("resetChannelDbBtn");

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
    predicted: { label: "PREDICTED", color: "var(--waived-soft)", tint: "var(--waived-dim)" },
    unclassified: { label: "UNRESOLVED", color: "var(--partial-soft)", tint: "var(--partial-dim)" },
  };

  function sourceBadgeHtml(source) {
    const badge = SOURCE_BADGES[source] || SOURCE_BADGES.predicted;
    return `<span class="micro-badge" style="background:${badge.tint}; color:${badge.color}; border-color:${badge.tint};">${badge.label}</span>`;
  }

  // Channel database — the one piece of the old debugger tab that survives
  // (audit R4: "they are rules about what counts as what"), moved under
  // Rules and stripped of the internal-vocabulary framing.
  function renderChannelsTable() {
    const channelsTableBody = document.getElementById("channelsTableBody");
    if (!channelsTableBody) return;
    channelsTableBody.innerHTML = "";
    const channels = listChannels();

    if (channels.length === 0) {
      channelsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-faint); padding: 16px;">No channel classifications stored yet. Watch a YouTube video, or use “+ Add / Classify Channel”.</td></tr>`;
      return;
    }

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
          <button class="btn-ghost del-ch-btn" type="button" style="padding: 4px 8px; font-size: 11px; color: var(--missed);" title="Forget this classification and let prediction decide again">Reset</button>
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

  loadData();
});
