// ===== popup.js — the popup =====
//
// Two jobs, in this order:
//   1. Let the user rule the site they are currently looking at, here, in one
//      tap. This was previously a seven-step trip through a new browser tab
//      (PRODUCT-AUDIT.md §3.2), which is why the popup had nothing to do.
//   2. Report today honestly — including reporting nothing while it is still
//      loading, rather than painting "0m · 100% focus" first.

const ONBOARDING_KEY = "onboardingSeenAt";

const todayTotalEl = document.getElementById("todayTotal");
const focusValEl = document.getElementById("focusVal");
const focusLblEl = document.getElementById("focusLbl");
const topSitesList = document.getElementById("topSitesList");
const refusalsValEl = document.getElementById("refusalsVal");
const rulesValEl = document.getElementById("rulesVal");
const currentSiteEl = document.getElementById("currentSite");
const statusEl = document.getElementById("popupStatus");
const appEl = document.getElementById("app");

const openRecordBtn = document.getElementById("openRecordBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");

// The three rule modes, in the product's own words. The stored `mode` values
// are unchanged — this is the vocabulary layer only (docs/GLOSSARY.md §2).
const MODE_LABELS = {
  limit: "Daily limit",
  restraint: "Pause first",
  block: "Always closed",
};

const MODE_EXPLAINERS = {
  limit: "After the minutes are gone, the site stops opening until tomorrow.",
  restraint: "Sixty seconds, two problems and one written sentence before it opens. Every time.",
  block: "It doesn't open. Changing that later costs the same sixty seconds.",
};

let cachedSites = null;
let activeDomain = null;
let formOpen = false;
let formMode = "limit";

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function monogram(name) {
  return (String(name || "?").charAt(0) || "?").toUpperCase();
}

function setStatus(text, tone = "is-ok") {
  if (!statusEl) return;
  statusEl.textContent = text || "";
  statusEl.className = "status-message " + (text ? tone : "");
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

if (openRecordBtn) openRecordBtn.addEventListener("click", () => openOptions("#tab-record"));
if (openSettingsBtn) openSettingsBtn.addEventListener("click", () => openOptions("#tab-settings"));

// ---------------------------------------------------------------- active tab

// Only http(s) pages can carry a rule. chrome://, the Web Store and extension
// pages can't be limited, and saying so is better than offering an action that
// silently does nothing.
async function resolveActiveDomain() {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.query) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeDomain(url.hostname) || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- current site

function describeRule(entry) {
  if (!entryHasRule(entry)) return null;
  if (isRuleSuspended(entry)) return { text: suspensionLabel(entry), cls: "cs-rule" };
  if (entry.mode === "limit") {
    return { text: `${MODE_LABELS.limit} · ${entry.limitMinutes || 30}m`, cls: "cs-rule-limit" };
  }
  return { text: MODE_LABELS[entry.mode] || "Rule set", cls: `cs-rule-${entry.mode}` };
}

function renderCurrentSite() {
  if (!currentSiteEl) return;

  if (!activeDomain) {
    currentSiteEl.innerHTML = `
      <div class="cs-head">
        <div class="cs-monogram">—</div>
        <div class="cs-info">
          <div class="cs-domain">No site to rule</div>
          <div class="cs-meta">This page isn't one Stoic can time</div>
        </div>
      </div>
      <p class="cs-note">Open an ordinary web page and Stoic will offer to rule it from here.</p>`;
    return;
  }

  const entry = (cachedSites && cachedSites[activeDomain]) || {};
  const displayName = getDomainDisplayName(activeDomain);
  const usedSeconds = cachedSites ? usageSecondsForDate(entry, todayStr(), todayStr()) : 0;
  const rule = describeRule(entry);
  const hasRule = !!rule;

  // Kept short enough to survive a long domain name without truncating.
  const meta = hasRule
    ? (entry.mode === "limit" && !isRuleSuspended(entry)
        ? `<span class="${rule.cls}">${fmtDuration(usedSeconds)} of ${entry.limitMinutes || 30}m</span>`
        : `<span class="${rule.cls}">${escapeHtml(rule.text)}</span> · ${fmtDuration(usedSeconds)}`)
    : `${fmtDuration(usedSeconds)} today · no rule`;

  const actionLabel = hasRule ? "Change" : "Limit this site";

  currentSiteEl.innerHTML = `
    <div class="cs-head">
      <div class="cs-monogram">${escapeHtml(monogram(displayName))}</div>
      <div class="cs-info">
        <div class="cs-domain" title="${escapeHtml(activeDomain)}">${escapeHtml(displayName)}</div>
        <div class="cs-meta">${meta}</div>
      </div>
      <button class="btn-accent cs-action" id="csToggleBtn" type="button" aria-expanded="${formOpen}">${actionLabel}</button>
    </div>
    ${formOpen ? renderForm(entry) : ""}`;

  const toggleBtn = document.getElementById("csToggleBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      formOpen = !formOpen;
      if (formOpen) formMode = entryHasRule(entry) ? entry.mode : "limit";
      setStatus("");
      renderCurrentSite();
      if (formOpen) {
        const first = currentSiteEl.querySelector("#csMinutes, .seg-btn.active");
        if (first) first.focus();
      }
    });
  }

  if (formOpen) wireForm(entry);
}

function renderForm(entry) {
  const minutes = entry.limitMinutes || 30;
  const seg = ["limit", "restraint", "block"].map((mode) => (
    `<button class="seg-btn${mode === formMode ? " active" : ""}" type="button" data-value="${mode}">${MODE_LABELS[mode]}</button>`
  )).join("");

  return `
    <div class="cs-form" id="csForm">
      <div class="segmented" id="csModeSeg">${seg}</div>
      <div class="cs-form-row" id="csMinutesRow"${formMode === "limit" ? "" : " hidden"}>
        <label for="csMinutes">Minutes a day</label>
        <input class="field" type="number" id="csMinutes" min="1" max="1440" value="${minutes}" />
        <span class="unit">min</span>
      </div>
      <p class="cs-form-explainer" id="csExplainer">${MODE_EXPLAINERS[formMode]}</p>
      <div class="cs-form-actions">
        <button class="btn-ghost" type="button" id="csCancelBtn">Cancel</button>
        <button class="btn-accent" type="button" id="csSaveBtn">Save rule</button>
      </div>
    </div>`;
}

function wireForm(entry) {
  const seg = document.getElementById("csModeSeg");
  const minutesRow = document.getElementById("csMinutesRow");
  const minutesInput = document.getElementById("csMinutes");
  const explainer = document.getElementById("csExplainer");
  const saveBtn = document.getElementById("csSaveBtn");
  const cancelBtn = document.getElementById("csCancelBtn");

  if (seg) {
    seg.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        formMode = btn.getAttribute("data-value");
        seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
        if (minutesRow) minutesRow.hidden = formMode !== "limit";
        if (explainer) explainer.textContent = MODE_EXPLAINERS[formMode];
      });
    });
  }

  // Enter saves. Typing a number and reaching for the mouse is friction the
  // product should spend on opening sites, not on closing them.
  if (minutesInput) {
    minutesInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveRule(entry);
      }
    });
  }

  if (saveBtn) saveBtn.addEventListener("click", () => saveRule(entry));
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      formOpen = false;
      setStatus("");
      renderCurrentSite();
    });
  }
}

async function saveRule(existing) {
  const minutesInput = document.getElementById("csMinutes");
  const limitMinutes = Math.max(1, Number(minutesInput && minutesInput.value) || 30);

  const updatedEntry = {
    ...existing,
    mode: formMode,
    limitMinutes: formMode === "limit" ? limitMinutes : 0,
    schedule: existing.schedule || { days: [0, 1, 2, 3, 4, 5, 6], startTime: "", endTime: "" },
    createdAt: existing.createdAt || todayStr(),
  };

  // The popup deliberately has no friction gate of its own. If a change would
  // loosen an existing rule it is refused here and sent to Settings, where the
  // same sixty-second gate that guards the blocked page is waiting. A second,
  // cheaper gate in a second surface would defeat the point of having one.
  if (isLooseningRule(existing, updatedEntry)) {
    setStatus("Loosening a rule takes the same sixty seconds as pushing through one. Open Stoic to do it.", "is-warn");
    openOptions("#tab-rules");
    return;
  }

  const hadRule = entryHasRule(existing);

  cachedSites[activeDomain] = updatedEntry;
  await saveSites(cachedSites);
  if (!hadRule) {
    await sendProgressionEvent("rule_created", { domain: activeDomain });
  }

  formOpen = false;
  setStatus(
    formMode === "limit"
      ? `${getDomainDisplayName(activeDomain)} is now ${limitMinutes} minutes a day.`
      : `${getDomainDisplayName(activeDomain)}: ${MODE_LABELS[formMode].toLowerCase()}.`,
    "is-ok"
  );
  await render();
}

// ------------------------------------------------------------------- today

function renderToday(sites, today) {
  const browsing = getBrowsingStats(sites, today);
  if (todayTotalEl) {
    todayTotalEl.textContent = fmtDuration(browsing.totalSeconds);
    todayTotalEl.classList.remove("is-pending");
  }

  if (focusValEl) {
    const score = calculateFocusScore(sites, today);
    focusValEl.textContent = `${score}`;
    focusValEl.className = "today-val tabular " + (score >= 70 ? "is-held" : score >= 45 ? "is-partial" : "is-missed");
    if (focusLblEl) focusLblEl.textContent = "Focus score";
  }

  return browsing;
}

function renderTopSites(browsing) {
  if (!topSitesList) return;
  topSitesList.innerHTML = "";

  const top3 = (browsing.topWebsites || []).slice(0, 3);

  if (top3.length === 0) {
    topSitesList.innerHTML = `
      <div class="empty-state empty-state-inline">
        <span class="empty-state-body">Nothing tracked yet today. Sites appear here once you've spent a minute on them.</span>
      </div>`;
    return;
  }

  const maxSec = Math.max(1, top3[0].seconds || 1);

  top3.forEach((item) => {
    const displayName = getDomainDisplayName(item.domain);
    const fillPct = item.seconds > 0 ? Math.max(6, Math.round((item.seconds / maxSec) * 100)) : 0;

    const row = document.createElement("div");
    row.className = "site-row";
    // A monogram, not a favicon: fetching favicons from Google would hand the
    // user's most-visited domains to Google every time the popup opens.
    row.innerHTML = `
      <div class="site-monogram">${escapeHtml(monogram(displayName))}</div>
      <div class="site-info">
        <div class="site-header">
          <span class="site-name">${escapeHtml(displayName)}</span>
          <span class="site-time">${fmtDuration(item.seconds)}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${fillPct}%;"></div>
        </div>
      </div>`;
    topSitesList.appendChild(row);
  });
}

// -------------------------------------------------------------- progression

async function renderProgression(sites) {
  const progStripEl = document.getElementById("progStrip");
  const progBannerEl = document.getElementById("progLevelUpBanner");
  if (!progStripEl && !progBannerEl) return;

  const prog = await loadProgression();
  const liveDay = buildLiveDayView(sites, prog);

  if (progStripEl) progStripEl.innerHTML = renderPopupStrip(prog, liveDay);

  // "Turned back from this site: N times" is the most on-brand sentence the
  // product can say, and it previously appeared in exactly one small cell on
  // one page (PRODUCT-AUDIT.md §4 item 24). It belongs here.
  if (refusalsValEl) refusalsValEl.textContent = `${(prog.lifetime && prog.lifetime.refusals) || 0}`;

  if (progBannerEl) {
    progBannerEl.innerHTML = renderLevelUpBanner(prog);
    const dismissBtn = progBannerEl.querySelector(".prog-levelup-dismiss");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", async () => {
        progBannerEl.innerHTML = "";
        await sendProgressionEvent("level_up_seen", {});
      });
    }
  }
}

// ------------------------------------------------------------------- render

async function render() {
  await ensureYouTubeStoresLoaded();
  cachedSites = await getSites();
  const today = todayStr();

  const browsing = renderToday(cachedSites, today);
  renderTopSites(browsing);
  renderCurrentSite();

  const moderation = getModerationStats(cachedSites, today);
  if (rulesValEl) rulesValEl.textContent = `${moderation.limitedSitesCount}`;

  await renderProgression(cachedSites);
}

// ---------------------------------------------------------------- first run

async function shouldShowOnboarding() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return false;
  const stored = await chrome.storage.local.get(ONBOARDING_KEY);
  return !stored[ONBOARDING_KEY];
}

async function dismissOnboarding() {
  const onboardingEl = document.getElementById("onboarding");
  if (onboardingEl) onboardingEl.hidden = true;
  if (appEl) appEl.hidden = false;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [ONBOARDING_KEY]: Date.now() });
  }
  await render();
}

function setupOnboarding() {
  const onboardingEl = document.getElementById("onboarding");
  const panels = Array.from(onboardingEl.querySelectorAll(".onboard-panel"));
  const dotsEl = document.getElementById("onboardDots");
  const nextBtn = document.getElementById("onboardNextBtn");
  const skipBtn = document.getElementById("onboardSkipBtn");
  const ruleSlot = document.getElementById("onboardRuleSlot");
  let step = 0;

  dotsEl.innerHTML = panels.map(() => `<span class="onboard-dot"></span>`).join("");

  function show(index) {
    step = index;
    panels.forEach((p, i) => { p.hidden = i !== index; });
    Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle("is-current", i === index));
    nextBtn.textContent = index === panels.length - 1 ? "Done" : "Next";
    skipBtn.hidden = index === panels.length - 1;

    // The last panel offers a rule for the tab the user already has open —
    // the whole first-run sequence ends in the product's primary action, not
    // in a "Get started" button that leads to an empty dashboard.
    if (index === panels.length - 1) {
      ruleSlot.innerHTML = "";
      ruleSlot.appendChild(currentSiteEl);
      formOpen = !!activeDomain;
      formMode = "limit";
      renderCurrentSite();
    }
  }

  nextBtn.addEventListener("click", async () => {
    if (step === panels.length - 1) {
      // Put the primary control back where it lives before handing over.
      if (appEl && currentSiteEl.parentElement === ruleSlot) {
        appEl.insertBefore(currentSiteEl, document.getElementById("todayRow"));
      }
      formOpen = false;
      await dismissOnboarding();
      return;
    }
    show(step + 1);
  });

  skipBtn.addEventListener("click", async () => {
    if (appEl && currentSiteEl.parentElement === ruleSlot) {
      appEl.insertBefore(currentSiteEl, document.getElementById("todayRow"));
    }
    formOpen = false;
    await dismissOnboarding();
  });

  onboardingEl.hidden = false;
  if (appEl) appEl.hidden = true;
  show(0);
}

// --------------------------------------------------------------------- boot

document.addEventListener("DOMContentLoaded", async () => {
  applyTheme(await getThemePreference());
  activeDomain = await resolveActiveDomain();

  if (await shouldShowOnboarding()) {
    cachedSites = await getSites();
    setupOnboarding();
  } else {
    if (appEl) appEl.hidden = false;
    await render();
  }

  // Fire-and-forget: an idle browser only settles progression when something
  // checks in. Opening the popup is exactly that moment
  // (03-IMPLEMENTATION-SPEC.md §6.1).
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: "REQUEST_SETTLEMENT" }, () => {
      if (chrome.runtime.lastError) {
        /* ignore — no receiving end */
      }
    });
  }
});

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    // Don't repaint underneath a form the user is mid-way through filling in.
    if ((area === "local" || area === "sync") && !formOpen && appEl && !appEl.hidden) {
      render();
    }
  });
}
