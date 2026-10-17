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
  const optTopWebsitesList = document.getElementById("optTopWebsitesList");
  const optOverviewTrippedCount = document.getElementById("optOverviewTrippedCount");
  const optOverviewRefusals = document.getElementById("optOverviewRefusals");


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

  const optCategoryGrid = document.getElementById("optCategoryGrid");
  const optDomainAuditTable = document.getElementById("optDomainAuditTable");

  // Progress tab refs (progression-ui.js fills these; options.js never
  // builds progression markup itself, per 02-ARCHITECTURE.md §7).
  const progLevelUpBannerOptions = document.getElementById("progLevelUpBannerOptions");
  const progIdentityContainer = document.getElementById("progIdentityContainer");
  const progStandingContainer = document.getElementById("progStandingContainer");
  const progStreaksContainer = document.getElementById("progStreaksContainer");
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
  const optModalExceptionPicker = document.getElementById("optModalExceptionPicker");
  const optModalExceptionMinutes = document.getElementById("optModalExceptionMinutes");

  const optModalRestraintRow = document.getElementById("optModalRestraintRow");
  const optModalActionRow = document.getElementById("optModalActionRow");
  const optModalActionSeg = document.getElementById("optModalActionSeg");
  const optModalRedirect = document.getElementById("optModalRedirect");
  const optModalRedirectError = document.getElementById("optModalRedirectError");

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
  let modalAction = "page";

  // Per-day exceptions: minutes keyed by JS day index (0=Sun…6=Sat). Lets a
  // site that's otherwise "always closed" or "pause first" carry a "but N
  // minutes on Saturday" carve-out — see schedule.dayLimits / dayOverrideMinutes
  // in common.js, which is what actually enforces this at runtime.
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let exceptionMinutes = {};

  function renderExceptionRows() {
    optModalExceptionMinutes.innerHTML = "";
    Object.keys(exceptionMinutes)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((day) => {
        const row = document.createElement("div");
        row.className = "field-row";
        row.innerHTML = `
          <label>${DAY_NAMES[Number(day)]}</label>
          <input class="field field-narrow" type="number" min="1" value="${exceptionMinutes[day]}" data-exception-day="${day}" />
          <span class="unit">min/day</span>
          <button class="btn-ghost btn-compact" type="button" data-remove-exception="${day}">Remove</button>
        `;
        optModalExceptionMinutes.appendChild(row);
      });

    optModalExceptionMinutes.querySelectorAll("[data-exception-day]").forEach((input) => {
      input.addEventListener("input", () => {
        const day = input.getAttribute("data-exception-day");
        exceptionMinutes[day] = Math.max(1, Number(input.value) || 1);
      });
    });
    optModalExceptionMinutes.querySelectorAll("[data-remove-exception]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const day = btn.getAttribute("data-remove-exception");
        delete exceptionMinutes[day];
        optModalExceptionPicker.querySelectorAll(".day-btn").forEach((dayBtn) => {
          if (dayBtn.getAttribute("data-day") === day) dayBtn.classList.remove("active");
        });
        renderExceptionRows();
      });
    });
  }

  optModalExceptionPicker.querySelectorAll(".day-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.getAttribute("data-day");
      const nowActive = !btn.classList.contains("active");
      btn.classList.toggle("active", nowActive);
      if (nowActive) {
        if (!exceptionMinutes[day]) exceptionMinutes[day] = 10;
      } else {
        delete exceptionMinutes[day];
      }
      renderExceptionRows();
    });
  });

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
    syncModalModeRows();
  });

  wireSegmented(optModalActionSeg, (val) => setModalAction(val));

  // Record tab: which period is showing, and how far back.
  let recPeriod = "week";
  let recOffset = 0;
  const recPrevBtn = document.getElementById("recPrevBtn");
  const recNextBtn = document.getElementById("recNextBtn");
  wireSegmented(document.getElementById("recPeriodSeg"), (val) => {
    recPeriod = val;
    recOffset = 0;
    if (progState) renderRecord(progState);
  });
  recPrevBtn?.addEventListener("click", () => { recOffset--; if (progState) renderRecord(progState); });
  recNextBtn?.addEventListener("click", () => { recOffset = Math.min(0, recOffset + 1); if (progState) renderRecord(progState); });

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
      const refusals = (prog.lifetime && prog.lifetime.refusals) || 0;
      optOverviewRefusals.textContent = refusals;
      optOverviewRefusals.classList.toggle("is-held", refusals > 0);
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

  const MODE_LABELS = { limit: "Daily limit", restraint: "Pause first", block: "Always closed" };
  let progState = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  const catClass = (macro) => `cat-${String(macro || "General").toLowerCase()}`;
  const scoreTier = (score) => (score >= 70 ? "is-held" : score >= 45 ? "is-partial" : "is-missed");
  const monogram = (name) => esc((String(name || "?").charAt(0) || "?").toUpperCase());

  // Total tracked seconds per day for the last `n` days, oldest first.
  function dailyTotals(n) {
    const now = new Date();
    const todayKey = dateKey(now);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(now, -i);
      const key = dateKey(d);
      let seconds = 0;
      for (const entry of Object.values(sites)) seconds += usageSecondsForDate(entry, key, todayKey);
      out.push({ key, label: DAY_LABELS[d.getDay()], seconds, isToday: i === 0 });
    }
    return out;
  }

  function ruleTag(entry) {
    if (!entryHasRule(entry)) return "";
    const suspended = isRuleSuspended(entry);
    return `<span class="tag tag-${entry.mode}${suspended ? " tag-suspended" : ""}">${suspended ? "Suspended" : MODE_LABELS[entry.mode]}</span>`;
  }

  // Today's position of a daily-limit rule: used, limit, and how it reads.
  function limitPosition(entry, now = new Date()) {
    const today = todayStr();
    const usedSec = usageSecondsForDate(entry, today, today);
    const limitMin = limitMinutesForDate(entry, now);
    const pct = limitMin ? Math.min(100, Math.round((usedSec / (limitMin * 60)) * 100)) : 0;
    const spent = limitMin > 0 && usedSec >= limitMin * 60;
    const cls = spent ? "is-missed" : pct >= 75 ? "is-partial" : "";
    return { usedSec, limitMin, pct, spent, cls };
  }

  function renderAll() {
    const today = todayStr();
    const browsing = getBrowsingStats(sites, today);
    const moderation = getModerationStats(sites, today);
    const focusScore = calculateFocusScore(sites, today);
    const totals = dailyTotals(7);

    const dateEl = document.getElementById("optTodayDate");
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

    if (optTodayTotal) optTodayTotal.textContent = fmtDuration(browsing.totalSeconds);
    const vsAvg = document.getElementById("optTodayVsAvg");
    if (vsAvg) {
      const prior = totals.slice(0, 6).filter((d) => d.seconds > 0);
      vsAvg.textContent = prior.length
        ? `Daily average ${fmtDuration(prior.reduce((sum, d) => sum + d.seconds, 0) / prior.length)}`
        : "Across every site";
    }

    const tracked = browsing.totalSeconds;
    const ringEl = document.getElementById("optFocusRing");
    if (ringEl) {
      // Descriptive, never a verdict (docs/GLOSSARY.md §3).
      const caption = tracked === 0 ? "Nothing yet"
        : focusScore >= 70 ? "Mostly productive"
        : focusScore >= 45 ? "A mixed day"
        : "Mostly leisure";
      ringEl.innerHTML = heroRing(tracked > 0 ? focusScore : null, "Focus", caption);
    }

    const visitedEl = document.getElementById("optSitesVisited");
    if (visitedEl) visitedEl.textContent = browsing.topWebsites.filter((w) => w.seconds > 0).length;
    const ruleDomains = Object.keys(sites).filter((d) => entryHasRule(sites[d]));
    const inForce = ruleDomains.filter((d) => ruleStatus(sites[d]).state === "active").length;
    const inForceEl = document.getElementById("optRulesInForce");
    if (inForceEl) inForceEl.textContent = inForce;
    const inForceSub = document.getElementById("optRulesInForceSub");
    if (inForceSub) inForceSub.textContent = ruleDomains.length ? `of ${ruleDomains.length} rule${ruleDomains.length === 1 ? "" : "s"}` : "no rules yet";

    const splitEl = document.getElementById("optTodaySplit");
    if (splitEl) {
      const macros = (browsing.categoryBreakdown && browsing.categoryBreakdown.macroBreakdown) || [];
      splitEl.innerHTML = macros
        .filter((m) => m.seconds > 0)
        .map((m) => `<span class="cat-seg ${catClass(m.macro)}" style="flex-grow:${m.seconds}" title="${esc(MACRO_CATEGORIES[m.macro]?.label || m.macro)} ${m.pctOfTotal}%"></span>`)
        .join("");
    }

    if (optOverviewTrippedCount) {
      optOverviewTrippedCount.textContent = moderation.limitsTriggeredToday;
      optOverviewTrippedCount.classList.toggle("is-missed", moderation.limitsTriggeredToday > 0);
    }
    renderLifetimeRefusals();

    renderOverviewTopWebsites(browsing.topWebsites);
    renderRulesNow();
    renderSyncSection();
    renderAnalytics(browsing);
    renderDisciplines();
    renderChannelsTable();
    renderProgress().catch((err) => console.error("[Stoic] progress tab render failed", err));
  }

  // progression-ui.js owns the progression markup; options.js only places
  // it (02-ARCHITECTURE.md §7).
  async function renderProgress() {
    const prog = await loadProgression();
    const hadProg = !!progState;
    progState = prog;
    // Rule rows show each rule's streak, which lives in the ledger.
    if (!hadProg) renderDisciplines();

    if (progIdentityContainer) progIdentityContainer.innerHTML = renderLevelIdentity(prog);
    const heroSide = document.getElementById("optHeroSide");
    if (heroSide) heroSide.innerHTML = heroBadges(prog);
    if (progStandingContainer) progStandingContainer.innerHTML = renderTodayStanding(buildLiveDayView(sites, prog));
    if (progStreaksContainer) progStreaksContainer.innerHTML = renderStreaks(prog);
    renderRecord(prog);
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

    if (optLeisureCeilingInput && document.activeElement !== optLeisureCeilingInput) {
      optLeisureCeilingInput.value = prog.config.leisureCeilingMinutes;
    }
    if (optFocusTargetInput && document.activeElement !== optFocusTargetInput) {
      optFocusTargetInput.value = prog.config.focusTarget;
    }
  }

  function renderOverviewTopWebsites(topWebsites) {
    if (!optTopWebsitesList) return;
    const list = (topWebsites || []).filter((item) => item.seconds > 0);
    const countEl = document.getElementById("optSitesCount");
    if (countEl) countEl.textContent = list.length ? `${list.length} site${list.length === 1 ? "" : "s"}` : "";

    if (list.length === 0) {
      optTopWebsitesList.innerHTML = emptyState("Nothing tracked yet today", "Time is counted while a site is the tab you're looking at.");
      return;
    }

    const maxSec = Math.max(1, list[0].seconds);
    // A monogram, not a favicon: fetching favicons from Google would hand
    // over the user's most-visited domains every time this page renders.
    optTopWebsitesList.innerHTML = list.slice(0, 8).map((item) => {
      const name = getDomainDisplayName(item.domain);
      const macro = (item.taxonomy && item.taxonomy.macro) || "General";
      const fill = Math.max(2, Math.round((item.seconds / maxSec) * 100));
      return `
        <div class="site-row ${catClass(macro)}">
          <span class="avatar">${monogram(name)}</span>
          <div class="site-main">
            <div class="site-name-line">
              <span class="site-name">${esc(name)}</span>
              ${ruleTag(item.entry)}
              <span class="site-domain" title="${esc(MACRO_CATEGORIES[macro]?.label || macro)}">${esc(item.domain)}</span>
            </div>
            <div class="site-bar"><div class="site-bar-fill" style="width:${fill}%"></div></div>
          </div>
          <span class="site-time">${fmtDuration(item.seconds)}</span>
          <span class="site-pct">${item.pctOfTotal}%</span>
        </div>`;
    }).join("");
  }

  // The live "how am I doing against each rule" list on Today.
  function renderRulesNow() {
    const el = document.getElementById("optRulesNow");
    if (!el) return;
    const today = todayStr();
    const domains = Object.keys(sites).filter((d) => entryHasRule(sites[d]));
    if (domains.length === 0) {
      el.innerHTML = emptyState("No rules yet", "Add one from the Rules tab or from the toolbar while you're on the site.");
      return;
    }
    el.innerHTML = domains
      .sort((a, b) => getDomainDisplayName(a).localeCompare(getDomainDisplayName(b)))
      .map((domain) => {
        const entry = sites[domain];
        const status = ruleStatus(entry);
        const trips = tripsForDate(entry, today, today);
        let value = `${trips}× stopped`;
        let bar = "";
        let statusText = status.text;
        let statusCls = status.state;
        if (entry.mode === "limit" && status.state === "active") {
          const pos = limitPosition(entry);
          value = `${fmtDuration(pos.usedSec)} / ${pos.limitMin}m`;
          bar = `<div class="rule-bar"><div class="rule-bar-fill ${pos.cls}" style="width:${pos.pct}%"></div></div>`;
          if (pos.spent) { statusText = "Spent for today"; statusCls = "spent"; }
          else statusText = `${fmtMinutes(pos.limitMin - pos.usedSec / 60)} left`;
        } else if (status.state === "active") {
          statusText = MODE_LABELS[entry.mode];
        }
        return `
          <div class="now-row">
            <span class="now-name">${esc(getDomainDisplayName(domain))}</span>
            <span class="now-value">${value}</span>
            <span class="status status-${statusCls}">${esc(statusText)}</span>
            ${bar}
          </div>`;
      }).join("");
  }

  function renderSyncSection() {
    if (optSyncToggle) optSyncToggle.checked = storagePref === "sync";
  }

  function renderAnalytics(browsing) {
    renderCategoryGrid(browsing.categoryBreakdown);
    renderAuditTable(browsing);
  }

  // ---------- hero pieces (Today + Record) ----------

  const ICON_FLAME = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c.6 3.2 3.4 5 4.6 8.2 1.5 4-1 9.8-4.6 9.8s-6.6-2.6-5.9-6.6c.4-2.3 1.9-3.6 2.9-4.9.3 1.8 1 2.8 2.1 3.3-.6-3.5.1-6.6.9-9.8z"/></svg>`;
  const ICON_STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.3l6.6-.8z"/></svg>`;

  // A score ring. null means "no score", never 100.
  function heroRing(score, label, caption) {
    const r = 52;
    const c = +(2 * Math.PI * r).toFixed(1);
    const off = score == null ? c : +(c * (1 - score / 100)).toFixed(1);
    return `
      <svg viewBox="0 0 128 128" class="ring-svg">
        <circle cx="64" cy="64" r="${r}" class="ring-track" />
        <circle cx="64" cy="64" r="${r}" class="ring-fill" style="stroke-dasharray:${c};stroke-dashoffset:${off};--ring-c:${c}" />
      </svg>
      <div class="ring-label">
        <span class="ring-value">${score == null ? "—" : score}</span>
        <span class="ring-name">${label}</span>
      </div>
      ${caption ? `<span class="ring-caption">${caption}</span>` : ""}`;
  }

  function heroBadge(icon, value, label, cls = "") {
    return `<div class="hero-badge ${cls}"><span class="hero-badge-icon">${icon}</span><span class="hero-badge-text"><b>${value}</b><span>${label}</span></span></div>`;
  }

  function heroBadges(prog) {
    const streak = prog.streaks.discipline.current;
    const lvl = xpProgressForLevel(prog.level.xp);
    return heroBadge(ICON_FLAME, streak, `day streak · best ${prog.streaks.discipline.best}`, streak > 0 ? "is-hot" : "")
      + heroBadge(ICON_STAR, `Level ${lvl.level}`, `${lvl.rank.name} · ${Math.round(lvl.pct)}% to next`);
  }

  // One pill per day: its verdict as a colour.
  function dayPills(days, todayKey, compact) {
    return `<div class="pills${compact ? " pills-compact" : ""}">${days.map((d) => `
      <span class="pill pill-${d.status}${d.key === todayKey ? " is-today" : ""}" title="${d.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${d.status === "none" ? (d.t ? "not settled" : "no data") : d.status}">${compact ? "" : d.date.toLocaleDateString([], { weekday: "narrow" })}</span>`).join("")}</div>`;
  }

  // ---------- Record tab ----------
  // Surface: four numbers and one picture of the period. Everything else
  // (hover breakdowns, records, achievements, lifetime) sits one step down.

  function periodLabel(kind, start, end, offset) {
    if (kind === "year") return "The last twelve months";
    if (kind === "month") {
      const name = start.toLocaleDateString([], { month: "long", year: "numeric" });
      return offset === 0 ? `This month · ${name}` : name;
    }
    const fmt = (d) => d.toLocaleDateString([], { month: "short", day: "numeric" });
    const range = `${fmt(start)} – ${fmt(end)}`;
    return offset === 0 ? `This week · ${range}` : offset === -1 ? `Last week · ${range}` : range;
  }

  // A change against the previous period. `goodWhenUp` decides the colour;
  // the arrow only ever says which way it moved.
  function delta(curr, prev, { goodWhenUp, fmt, unit }) {
    if (curr == null || prev == null || !prev) return "";
    const diff = curr - prev;
    if (Math.abs(diff) < (unit === "time" ? 60 : 1)) return `<span class="delta">Same as before</span>`;
    const good = goodWhenUp ? diff > 0 : diff < 0;
    return `<span class="delta ${good ? "is-good" : "is-bad"}">${diff > 0 ? "↑" : "↓"} ${fmt(Math.abs(diff))}</span>`;
  }

  function summaryTile({ label, value, cls = "", sub = "", meter = null }) {
    return `
      <div class="kpi">
        <span class="kpi-label">${label}</span>
        <span class="kpi-value ${cls}">${value}</span>
        ${meter != null ? `<div class="meter"><div class="meter-fill ${cls}" style="width:${meter}%"></div></div>` : ""}
        <span class="kpi-sub">${sub}</span>
      </div>`;
  }

  function verdictSentence(kind, sum, offset) {
    const span = kind === "week" ? "week" : kind === "month" ? "month" : "year";
    const when = offset === 0 ? `this ${span}` : `that ${span}`;
    if (sum.t === 0) {
      return offset === 0
        ? `Nothing recorded ${when} yet. Every day you browse is written here, held or not.`
        : `Nothing was recorded ${when}.`;
    }
    if (sum.settled === 0) return `${fmtDuration(sum.t)} tracked ${when}. Today is still being written.`;
    if (sum.held === sum.settled) return `Every finished day ${when} was held. ${sum.held} of ${sum.settled}.`;
    if (sum.held === 0) return `No day held ${when} yet. The next one counts the same as any other.`;
    return `${sum.held} of ${sum.settled} finished days held ${when}.`;
  }

  function renderRecord(prog) {
    const todayKey = (prog.today && prog.today.date) || todayStr();
    const { start, end } = periodRange(recPeriod, recOffset, todayKey);
    const days = buildPeriodDays(prog, sites, start, end);
    const sum = summarizePeriod(days);
    const prevRange = recPeriod === "year" ? null : periodRange(recPeriod, recOffset - 1, todayKey);
    const prev = prevRange ? summarizePeriod(buildPeriodDays(prog, sites, prevRange.start, prevRange.end)) : null;

    const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    setText("recPeriodLabel", periodLabel(recPeriod, start, end, recOffset));
    setText("recVerdict", "");
    const focusCaption = prev && prev.focus != null && sum.focus != null
      ? (sum.focus > prev.focus ? `↑ ${sum.focus - prev.focus} vs ${recPeriod === "week" ? "last week" : "last month"}`
        : sum.focus < prev.focus ? `↓ ${prev.focus - sum.focus} vs ${recPeriod === "week" ? "last week" : "last month"}` : "Same as before")
      : "Whole period";
    setHtml("recHero", `
      <div class="hero-ring">${heroRing(sum.focus, "Focus", focusCaption)}</div>
      <div class="hero-main">
        <span class="hero-eyebrow">${periodLabel(recPeriod, start, end, recOffset)}</span>
        <p class="hero-verdict">${verdictSentence(recPeriod, sum, recOffset)}</p>
        ${recPeriod === "year"
          ? `<span class="hero-sub">${fmtDuration(sum.t)} tracked across ${sum.active} days</span>`
          : dayPills(days, todayKey, recPeriod === "month")}
      </div>
      <div class="hero-side">
        ${heroBadges(prog)}
      </div>`);
    if (recPrevBtn) recPrevBtn.hidden = recPeriod === "year";
    if (recNextBtn) { recNextBtn.hidden = recPeriod === "year"; recNextBtn.disabled = recOffset >= 0; }

    const vs = recPeriod === "week" ? "last week" : "last month";
    const heldPct = sum.settled ? Math.round((sum.held / sum.settled) * 100) : null;
    setHtml("recSummary", [
      summaryTile({
        label: "Days held",
        value: sum.settled ? `${sum.held}<small>/${sum.settled}</small>` : "—",
        cls: heldPct == null ? "" : heldPct >= 70 ? "is-held" : heldPct >= 40 ? "is-partial" : "is-missed",
        meter: heldPct,
        sub: sum.settled ? `${heldPct}% of finished days` : "No finished days yet",
      }),
      summaryTile({
        label: "Productive time",
        value: sum.p ? fmtDuration(sum.p) : "—",
        cls: sum.p ? "is-accent" : "",
        meter: sum.t ? Math.round((sum.p / sum.t) * 100) : null,
        sub: prev && prev.active ? delta(sum.p, prev.p, { goodWhenUp: true, fmt: fmtDuration, unit: "time" }) + ` vs ${vs}` : (sum.t ? `${Math.round((sum.p / sum.t) * 100)}% of tracked` : "Nothing tracked"),
      }),
      summaryTile({
        label: "Daily average",
        value: sum.active ? fmtDuration(sum.dailyAvg) : "—",
        sub: sum.active
          ? `${fmtDuration(sum.t)} over ${sum.active} day${sum.active === 1 ? "" : "s"}`
          : "Nothing tracked",
      }),
      summaryTile({
        label: "Leisure a day",
        value: sum.active ? fmtDuration(sum.leisureAvg) : "—",
        cls: sum.active ? (sum.leisureAvg <= prog.config.leisureCeilingMinutes * 60 ? "is-held" : "is-missed") : "",
        sub: sum.active
          ? (prev && prev.active ? delta(sum.leisureAvg, prev.leisureAvg, { goodWhenUp: false, fmt: fmtDuration, unit: "time" }) + ` vs ${vs}` : `Ceiling ${prog.config.leisureCeilingMinutes}m`)
          : `Ceiling ${prog.config.leisureCeilingMinutes}m`,
      }),
    ].join(""));

    const legend = document.getElementById("recLegend");
    if (legend) legend.hidden = recPeriod === "year"; // the grid carries its own
    setText("recChartTitle", recPeriod === "week" ? "Day by day" : recPeriod === "month" ? "The month at a glance" : "The year, day by day");
    setHtml("recChart",
      recPeriod === "week" ? renderWeekBars(days, todayKey)
        : recPeriod === "month" ? renderMonthCalendar(days, todayKey)
        : renderContributionGrid(prog));

    const shortDate = (d) => d.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const stat = (label, value, sub, cls = "") => `
      <div class="stat">
        <span class="stat-label">${label}</span>
        <span class="stat-value ${cls}">${value}</span>
        <span class="stat-sub">${sub}</span>
      </div>`;
    setHtml("recStats", [
      stat("Most productive day", sum.mostProductive ? fmtDuration(sum.mostProductive.p) : "—", sum.mostProductive ? shortDate(sum.mostProductive) : "Nothing tracked", sum.mostProductive ? "is-accent" : ""),
      stat("Best focus day", sum.bestFocus ? sum.bestFocus.f : "—", sum.bestFocus ? shortDate(sum.bestFocus) : "Needs a 30m day", sum.bestFocus ? scoreTier(sum.bestFocus.f) : ""),
      stat("Longest day", sum.longest ? fmtDuration(sum.longest.t) : "—", sum.longest ? shortDate(sum.longest) : "Nothing tracked"),
      stat("Times stopped", sum.gs, "by a rule"),
      stat("Turned back", sum.r, "chose not to go in", sum.r ? "is-held" : ""),
      stat("Rules broken", sum.v, sum.v ? "limits or pauses" : "none this period", sum.v ? "is-missed" : "is-held"),
    ].join(""));

    const target = prog.config.focusTarget;
    const scored = days.filter((d) => d.f != null && d.t >= 30 * 60);
    setText("recFocusMeta", scored.length ? `${scored.filter((d) => d.f >= target).length} of ${scored.length} days on target` : `Target ${target}`);
    setHtml("recFocus", scored.length ? renderFocusBars(days, target, todayKey) : emptyState(
      "No scored days yet",
      "A day gets a focus score once 30 minutes are tracked."
    ));

    setText("recSplitMeta", sum.t ? `${fmtDuration(sum.t)} in total` : "");
    setHtml("recSplit", renderPeriodSplit(sum) || emptyState(
      "Nothing to split yet",
      "Once time is tracked in this period, it shows how it divided between productive, general and leisure."
    ));
  }

  function renderCategoryGrid(categoryBreakdown) {
    if (!optCategoryGrid) return;
    const macros = (categoryBreakdown && categoryBreakdown.macroBreakdown) || [];

    if (macros.length === 0) {
      optCategoryGrid.innerHTML = emptyState(
        "Nothing to split yet",
        "Once a few minutes are tracked, this shows how the day divided between productive, general and leisure time."
      );
      return;
    }

    const today = todayStr();
    const bar = macros
      .map((mac) => `<div class="split-seg ${catClass(mac.macro)}" style="width:${mac.pctOfTotal}%" title="${esc(mac.macro)} ${mac.pctOfTotal}%"></div>`)
      .join("");

    const groups = macros.map((mac) => {
      const label = MACRO_CATEGORIES[mac.macro]?.label || mac.macro;
      const micros = mac.micros.map((m) => {
        // "Why?" only where YouTube actually contributed to this bucket (audit R5).
        const why = explainCategoryToday(mac.macro, m.micro, sites, today);
        const whyKey = `${mac.macro}|${m.micro}`;
        return `
          <div class="micro-item-row">
            <span class="micro-item-name">${esc(m.micro)}</span>
            <span class="micro-item-time">${fmtDuration(m.seconds)}</span>
            ${why ? `<button class="btn-ghost btn-compact why-toggle-btn" type="button" data-why-for="${esc(whyKey)}">Why?</button>` : ""}
          </div>
          ${why ? `
            <div class="why-panel" data-why-panel="${esc(whyKey)}" hidden>
              <p class="why-sentence">${esc(why.sentence)}</p>
              <button class="btn-ghost btn-compact why-classify-btn" type="button" data-channel-id="${esc(why.channelId || "")}" data-channel-name="${esc(why.channelName || "")}" data-macro="${esc(mac.macro)}" data-micro="${esc(m.micro)}">Classify this channel</button>
            </div>` : ""}`;
      }).join("");
      return `
        <div class="split-group ${catClass(mac.macro)}">
          <div class="split-head">
            <span class="cat-dot ${catClass(mac.macro)}"></span>
            <span class="split-name">${esc(label)}</span>
            <span class="split-time">${fmtDuration(mac.seconds)}</span>
            <span class="split-pct">${mac.pctOfTotal}%</span>
          </div>
          ${micros ? `<div class="split-micros">${micros}</div>` : ""}
        </div>`;
    }).join("");

    optCategoryGrid.innerHTML = `<div class="split-bar">${bar}</div>${groups}`;
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
    const list = (browsing.topWebsites || []).filter((item) => item.seconds > 0);

    if (list.length === 0) {
      optDomainAuditTable.innerHTML = emptyState(
        "Nothing tracked yet today",
        "Every site you spend time on appears here, with a rule one click away."
      );
      return;
    }

    // Derived from the taxonomy in common.js so a new category only needs
    // adding in one place.
    const taxonomyGroups = selectableMicrosByMacro();
    const today = todayStr();

    const rows = list.map((item) => {
      const name = getDomainDisplayName(item.domain);
      const { macro, micro } = item.taxonomy || getDomainTaxonomy(item.domain, sites);

      let options = "";
      Object.keys(taxonomyGroups).forEach((group) => {
        options += `<optgroup label="${esc(MACRO_CATEGORIES[group]?.label || group)}">`;
        taxonomyGroups[group].forEach((opt) => {
          options += `<option value="${esc(opt)}" ${micro === opt ? "selected" : ""}>${esc(opt)}</option>`;
        });
        options += `</optgroup>`;
      });
      if (micro && !MICRO_TO_MACRO[micro]) options += `<option value="${esc(micro)}" selected>${esc(micro)}</option>`;
      options += `<option value="__custom__">New category…</option>`;

      // The debugger's replacement (audit R5): YouTube rows only.
      const why = isYouTubeDomain(item.domain) ? explainDomainToday(item.domain, sites, today) : null;

      return `
        <tr>
          <td><span class="audit-site">${esc(name)}</span><span class="audit-domain">${esc(item.domain)}</span></td>
          <td>
            <div class="audit-cat">
              <span class="cat-dot ${catClass(macro)}" title="${esc(MACRO_CATEGORIES[macro]?.label || macro)}"></span>
              <select class="audit-cat-select" data-domain="${esc(item.domain)}" aria-label="Category for ${esc(name)}">${options}</select>
            </div>
          </td>
          <td class="num">${fmtDuration(item.seconds)}<span class="num-sub">${item.pctOfTotal}%</span></td>
          <td>${ruleTag(item.entry) || `<span class="panel-meta">No rule</span>`}</td>
          <td class="col-actions">
            ${why ? `<button class="btn-ghost btn-compact why-toggle-btn" type="button" data-why-for="${esc(item.domain)}">Why?</button>` : ""}
            <button class="btn-ghost btn-compact audit-action-btn" type="button" data-domain="${esc(item.domain)}">${entryHasRule(item.entry) ? "Edit rule" : "Add rule"}</button>
          </td>
        </tr>
        ${why ? `
          <tr class="why-panel-row" data-why-panel="${esc(item.domain)}" hidden>
            <td colspan="5">
              <div class="why-panel">
                <p class="why-sentence">${esc(why.sentence)}</p>
                <button class="btn-ghost btn-compact why-classify-btn" type="button" data-channel-id="${esc(why.channelId || "")}" data-channel-name="${esc(why.channelName || "")}" data-macro="${esc(why.macro)}" data-micro="${esc(why.micro)}">Classify this channel</button>
              </div>
            </td>
          </tr>` : ""}`;
    }).join("");

    optDomainAuditTable.innerHTML = `
      <table class="table">
        <thead><tr><th>Site</th><th>Category</th><th class="num">Today</th><th>Rule</th><th class="col-actions"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

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

  const STATUS_ORDER = { suspended: 0, active: 1, off: 2 };

  function ruleRowHtml(domain, entry) {
    const name = getDomainDisplayName(domain);
    const now = new Date();
    const today = todayStr();
    const todayKey = dateKey(now);
    const status = ruleStatus(entry, now);
    const trips = tripsForDate(entry, today, today);
    const usedSec = usageSecondsForDate(entry, today, today);
    const streak = progState && progState.streaks.rules && progState.streaks.rules[domain];

    let statusCls = status.state;
    let statusText = status.text;

    let todayHtml;
    const pos = entry.mode === "limit" ? limitPosition(entry, now) : null;
    if (pos && pos.limitMin) {
      if (status.state === "active" && pos.spent) { statusCls = "spent"; statusText = "Spent for today"; }
      todayHtml = `
        <div class="rule-today-line">
          <span class="rule-today-value">${fmtDuration(pos.usedSec)} <span>of ${pos.limitMin}m</span></span>
          <span class="rule-today-meta">${pos.spent ? "None left" : `${fmtMinutes(pos.limitMin - pos.usedSec / 60)} left`}</span>
        </div>
        <div class="rule-bar"><div class="rule-bar-fill ${pos.cls}" style="width:${pos.pct}%"></div></div>
        <span class="rule-today-meta">Stopped ${trips}× today</span>`;
    } else {
      todayHtml = `
        <div class="rule-today-line">
          <span class="rule-today-value">${trips}× <span>stopped today</span></span>
        </div>
        <span class="rule-today-meta">${usedSec > 0 ? `${fmtDuration(usedSec)} on the site today` : "No time on the site today"}</span>
        <span class="rule-today-meta">${entry.timesTripped || 0}× all time</span>`;
    }

    // Seven small bars: minutes against the limit for a daily limit,
    // times stopped for the other two.
    const week = trailingWeekUsage(entry, now);
    const values = week.map((d) => (pos ? d.seconds : tripsForDate(entry, d.date, todayKey)));
    const scale = Math.max(1, ...values, pos ? (pos.limitMin || 0) * 60 : 0);
    const bars = week.map((d, i) => {
      let cls = "";
      if (!d.scheduled) cls = "is-off";
      else if (pos && d.limitMinutes) cls = d.seconds > d.limitMinutes * 60 + 30 ? "is-over" : d.seconds > 0 ? "is-kept" : "";
      const h = values[i] > 0 ? Math.max(8, Math.round((values[i] / scale) * 100)) : 0;
      const tip = pos ? `${d.date}: ${fmtDuration(d.seconds)}` : `${d.date}: stopped ${values[i]}×`;
      return `<div class="rule-week-bar ${cls}" style="height:${cls === "is-off" ? 100 : h}%" title="${tip}"></div>`;
    }).join("");
    const labels = week.map((d) => `<span>${d.label.charAt(0)}</span>`).join("");

    const suspended = status.state === "suspended";
    return `
      <article class="rule${suspended ? " is-suspended" : ""}${status.state === "off" ? " is-off" : ""}" data-domain="${esc(domain)}">
        <div class="rule-id">
          <span class="avatar">${monogram(name)}</span>
          <div class="rule-id-text">
            <h3 class="rule-name">${esc(name)}</h3>
            <span class="rule-domain">${esc(domain)}</span>
            <div class="rule-what">
              <span class="tag tag-${entry.mode}">${MODE_LABELS[entry.mode]}</span>
              <span class="rule-sched">${esc(scheduleSummary(entry))}</span>
            </div>
            <span class="status status-${statusCls}">${esc(statusText)}${streak && streak.current > 0 ? ` · kept ${streak.current} day${streak.current === 1 ? "" : "s"}` : ""}</span>
          </div>
        </div>
        <div class="rule-today">${todayHtml}</div>
        <div class="rule-week">
          <div class="rule-week-bars">${bars}</div>
          <div class="rule-week-labels">${labels}</div>
          <span class="rule-week-caption">${pos ? "Last 7 days against the limit" : "Times stopped, last 7 days"}</span>
        </div>
        <div class="rule-actions">
          <button class="btn-ghost edit-btn" type="button">Edit</button>
          <button class="btn-ghost pause-btn" type="button">${suspended ? "Resume" : "Suspend"}</button>
          <button class="btn-ghost btn-ghost-danger delete-btn" type="button">Delete</button>
        </div>
        <div class="rule-suspend" hidden>
          <span>Suspend for</span>
          ${SUSPEND_OPTIONS.map((o) => `<button class="btn-ghost suspend-opt" type="button" data-option="${o.id}">${o.label}</button>`).join("")}
          <button class="link-btn suspend-cancel" type="button">Cancel</button>
        </div>
      </article>`;
  }

  function renderDisciplines() {
    if (!optDisciplinesGrid) return;
    const keys = Object.keys(sites).filter((d) => entryHasRule(sites[d]));

    const summary = document.getElementById("optRulesSummary");
    if (summary) {
      const suspendedCount = keys.filter((d) => isRuleSuspended(sites[d])).length;
      const today = todayStr();
      const tripsToday = keys.reduce((sum, d) => sum + tripsForDate(sites[d], today, today), 0);
      summary.textContent = keys.length
        ? [
            `${keys.length} rule${keys.length === 1 ? "" : "s"}`,
            suspendedCount ? `${suspendedCount} suspended` : "",
            `stopped you ${tripsToday}× today`,
          ].filter(Boolean).join(" · ")
        : "Everything you asked to be stopped from.";
    }

    const filtered = keys
      .filter((domain) => {
        const entry = sites[domain];
        if (activeFilter !== "all" && entry.mode !== activeFilter) return false;
        if (searchQuery && !domain.includes(searchQuery) && !getDomainDisplayName(domain).toLowerCase().includes(searchQuery)) return false;
        return true;
      })
      .sort((a, b) => {
        const sa = STATUS_ORDER[ruleStatus(sites[a]).state];
        const sb = STATUS_ORDER[ruleStatus(sites[b]).state];
        return sa - sb || getDomainDisplayName(a).localeCompare(getDomainDisplayName(b));
      });

    const emptyTitle = document.getElementById("optEmptyTitle");
    const emptyBody = document.getElementById("optEmptyBody");
    if (filtered.length === 0) {
      optDisciplinesGrid.innerHTML = "";
      optDisciplinesGrid.hidden = true;
      if (optEmptyState) optEmptyState.hidden = false;
      if (keys.length > 0) {
        if (emptyTitle) emptyTitle.textContent = "No rules match";
        if (emptyBody) emptyBody.textContent = "Try a different search or filter.";
        if (optCreateFirstBtn) optCreateFirstBtn.hidden = true;
      } else {
        if (emptyTitle) emptyTitle.textContent = "No rules yet";
        if (emptyBody) emptyBody.textContent = "A rule is how you ask to be stopped. Start with the one site that takes the most of your day.";
        if (optCreateFirstBtn) optCreateFirstBtn.hidden = false;
      }
      return;
    }

    optDisciplinesGrid.hidden = false;
    if (optEmptyState) optEmptyState.hidden = true;
    optDisciplinesGrid.innerHTML = filtered.map((domain) => ruleRowHtml(domain, sites[domain])).join("");

    optDisciplinesGrid.querySelectorAll(".rule").forEach((card) => {
      const domain = card.dataset.domain;
      const entry = sites[domain];
      const displayName = getDomainDisplayName(domain);
      const suspendRow = card.querySelector(".rule-suspend");

      card.querySelector(".edit-btn").addEventListener("click", () => openModal(domain));

      card.querySelector(".pause-btn").addEventListener("click", async () => {
        if (isRuleSuspended(entry)) {
          // Resuming tightens, so it is free.
          resumeRule(entry);
          await saveSites(sites);
          renderAll();
          return;
        }
        suspendRow.hidden = !suspendRow.hidden;
      });
      card.querySelector(".suspend-cancel").addEventListener("click", () => { suspendRow.hidden = true; });
      card.querySelectorAll(".suspend-opt").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const option = SUSPEND_OPTIONS.find((o) => o.id === btn.dataset.option);
          const proceed = await requestFrictionGate({
            title: `Suspend ${displayName} for ${option.label.toLowerCase()}?`,
            copy: "While it's suspended this rule does nothing, exactly as if you'd deleted it. It comes back on its own when the time is up.",
          });
          if (!proceed) return;
          suspendRule(entry, option.id);
          await saveSites(sites);
          renderAll();
        });
      });

      card.querySelector(".delete-btn").addEventListener("click", async () => {
        const proceed = await requestFrictionGate({
          title: `Delete the rule for ${displayName}?`,
          copy: `You set this rule up for a reason. Deleting it removes every limit on ${displayName}.`,
        });
        if (!proceed) return;
        // Keep the time history; only the rule goes.
        const { mode, limitMinutes, schedule, action, redirectUrl, paused, pausedUntil, ...rest } = entry;
        sites[domain] = { ...rest, mode: "unconstrained" };
        await saveSites(sites);
        await sendProgressionEvent("rule_deleted", { domain });
        renderAll();
      });
    });
  }

  // Modal logic
  function setModalAction(action, redirectUrl) {
    modalAction = action === "redirect" ? "redirect" : "page";
    optModalActionSeg.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-value") === modalAction);
    });
    optModalRedirect.hidden = modalAction !== "redirect";
    if (redirectUrl !== undefined) optModalRedirect.value = redirectUrl || "";
    optModalRedirectError.style.display = "none";
  }

  function syncModalModeRows() {
    optModalLimitRow.hidden = modalMode !== "limit";
    if (optModalRestraintRow) optModalRestraintRow.hidden = modalMode !== "restraint";
    // The pause always shows Stoic's page — sending someone elsewhere
    // would skip the pause entirely.
    optModalActionRow.hidden = modalMode === "restraint";
  }

  function openModal(domainKey = null) {
    editingDomainKey = domainKey;
    const editingEntry = domainKey && sites[domainKey];
    setModalAction(editingEntry && editingEntry.action, (editingEntry && editingEntry.redirectUrl) || "");
    optModalDomainError.style.display = "none";
    optModalDomainError.textContent = "";

    if (domainKey && sites[domainKey]) {
      const entry = sites[domainKey];
      const displayName = getDomainDisplayName(domainKey);
      optModalTitle.textContent = `Edit rule · ${displayName}`;
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

      exceptionMinutes = { ...schedule.dayLimits };
    } else {
      optModalTitle.textContent = "New rule";
      optModalDomain.value = "";
      optModalDomain.disabled = false;
      modalMode = "limit";
      optModalMinutes.value = "30";
      optModalStartTime.value = "";
      optModalEndTime.value = "";
      optModalDayPicker.querySelectorAll(".day-btn").forEach((btn) => btn.classList.add("active"));
      exceptionMinutes = {};
    }

    optModalExceptionPicker.querySelectorAll(".day-btn").forEach((btn) => {
      const d = btn.getAttribute("data-day");
      btn.classList.toggle("active", Object.prototype.hasOwnProperty.call(exceptionMinutes, d));
    });
    renderExceptionRows();

    optModalModeSeg.querySelectorAll(".seg-btn").forEach((btn) => {
      const isMatch = btn.getAttribute("data-value") === modalMode;
      btn.classList.toggle("active", isMatch);
    });
    syncModalModeRows();

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

    const selectedDays = new Set();
    optModalDayPicker.querySelectorAll(".day-btn.active").forEach((btn) => {
      selectedDays.add(Number(btn.getAttribute("data-day")));
    });
    // A day carrying an exception has to be a scheduled day too, or the
    // schedule considers it off entirely and the exception never fires.
    Object.keys(exceptionMinutes).forEach((day) => selectedDays.add(Number(day)));

    const limitMin = Number(optModalMinutes.value) || 30;
    const existing = sites[rawDomain] || {};

    let redirectUrl = "";
    if (modalAction === "redirect" && modalMode !== "restraint") {
      redirectUrl = optModalRedirect.value.trim();
      if (redirectUrl && !/^https?:\/\//i.test(redirectUrl)) redirectUrl = `https://${redirectUrl}`;
      let valid = false;
      try { valid = !!new URL(redirectUrl).hostname; } catch { valid = false; }
      if (!valid) {
        optModalRedirectError.textContent = "Enter the address to send you to, like todoist.com.";
        optModalRedirectError.style.display = "block";
        return;
      }
    }

    const updatedEntry = {
      ...existing,
      mode: modalMode,
      limitMinutes: modalMode === "limit" ? limitMin : 0,
      schedule: {
        days: Array.from(selectedDays),
        startTime: optModalStartTime.value || "",
        endTime: optModalEndTime.value || "",
        dayLimits: { ...exceptionMinutes },
      },
      action: redirectUrl ? "redirect" : "page",
      redirectUrl,
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
          return isLoosening(oldEntry, newEntry) || (!isRuleSuspended(oldEntry) && isRuleSuspended(newEntry));
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
      if (confirm("Forget every channel classification, including the ones you set yourself?")) {
        await clearChannelStore();
        await loadData();
      }
    });
  }

  if (addChannelBtn) {
    addChannelBtn.addEventListener("click", () => openClassifyModal({ kind: "channel" }));
  }

  const SOURCE_LABELS = {
    manual: "You",
    builtin: "Built in",
    predicted: "Predicted",
    unclassified: "Undecided",
  };

  // Channel classifications — the one piece of the old debugger that
  // survives (audit R4), in plain words.
  function renderChannelsTable() {
    const body = document.getElementById("channelsTableBody");
    if (!body) return;
    const channels = listChannels();
    const countEl = document.getElementById("ytChannelCount");
    if (countEl) countEl.textContent = channels.length ? `${channels.length} channel${channels.length === 1 ? "" : "s"}` : "";

    if (channels.length === 0) {
      body.innerHTML = `<tr><td colspan="4">${emptyState("No channels yet", "Channels appear here as you watch YouTube, or classify one yourself.")}</td></tr>`;
      return;
    }

    body.innerHTML = channels.map((channel, i) => {
      const cls = channel.classification || { macro: "General", micro: "Unclassified" };
      const macroLabel = MACRO_CATEGORIES[cls.macro]?.label || cls.macro;
      const source = SOURCE_LABELS[channel.source] || SOURCE_LABELS.predicted;
      const conf = channel.source === "predicted" ? ` · ${Math.round((channel.confidence ?? 0) * 100)}% sure` : "";
      return `
        <tr data-index="${i}">
          <td><span class="audit-site">${esc(channel.channelName || channel.channelId)}</span><span class="audit-domain">${esc(channel.channelId || "")}</span></td>
          <td><div class="audit-cat"><span class="cat-dot ${catClass(cls.macro)}"></span>${esc(macroLabel)} · ${esc(cls.micro)}</div></td>
          <td><span class="source-tag">${source}${conf}</span>${channel.reason ? `<span class="source-reason">${esc(channel.reason)}</span>` : ""}</td>
          <td class="col-actions">
            <button class="btn-ghost btn-compact edit-ch-btn" type="button">Classify</button>
            ${channel.source === "manual" || channel.pinned ? "" : `<button class="btn-ghost btn-compact reclass-ch-btn" type="button" title="Ask the predictor again">Re-predict</button>`}
            <button class="btn-ghost btn-compact btn-ghost-danger del-ch-btn" type="button" title="Forget this and let prediction decide">Forget</button>
          </td>
        </tr>`;
    }).join("");

    body.querySelectorAll("tr[data-index]").forEach((row) => {
      const channel = channels[Number(row.dataset.index)];
      const cls = channel.classification || { macro: "General", micro: "Unclassified" };
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
      if (reclassBtn) {
        reclassBtn.addEventListener("click", async () => {
          reclassBtn.disabled = true;
          reclassBtn.textContent = "Predicting…";
          try {
            await predictChannelClassification(
              { channelId: channel.channelId, channelName: channel.channelName },
              { forceReclassify: true }
            );
            await loadData();
          } catch (err) {
            alert("Prediction failed: " + err.message);
            reclassBtn.disabled = false;
            reclassBtn.textContent = "Re-predict";
          }
        });
      }
      row.querySelector(".del-ch-btn").addEventListener("click", async () => {
        if (confirm(`Forget how ${channel.channelName || channel.channelId} is classified?`)) {
          await unpinChannel({ channelId: channel.channelId, channelName: channel.channelName });
          await loadData();
        }
      });
    });
  }

  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = tabs.find((t) => t.getAttribute("data-target") === btn.dataset.goto);
      if (tab) selectTab(tab, { focus: true });
    });
  });

  // Live: the page used to show whatever was true when it was opened.
  // Re-read when the worker writes, but never under an open dialog or a
  // field being edited, and at most twice a second.
  let reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const editing = document.querySelector("dialog[open]") ||
        (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) ||
        (optDisciplinesGrid && optDisciplinesGrid.querySelector(".rule-suspend:not([hidden])"));
      if (editing) {
        scheduleReload();
        return;
      }
      loadData();
    }, 500);
  }
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if ((area === "local" || area === "sync") && (changes.sites || changes.progression)) scheduleReload();
    });
  }
  // Countdowns ("back at 3:40", "12m left") move with the clock.
  setInterval(() => { if (!document.hidden) scheduleReload(); }, 30000);

  loadData();
});
