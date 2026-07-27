// ---------- youtube-content.js ----------
// Content script for YouTube pages. Extracts rich video & channel metadata
// and listens for YouTube's SPA navigation events (yt-navigate-finish,
// yt-page-data-updated, DOM mutations) to keep metadata updated live.

(function () {
  // Longest we will let the debounce below defer a broadcast. YouTube
  // mutates the DOM more or less continuously (view counts, comments, live
  // chat), and a plain trailing debounce can be starved indefinitely by
  // that — which used to mean a video's metadata sometimes never reached
  // the background worker at all, so its watch time was attributed to
  // nothing in particular.
  const MAX_UPDATE_DELAY_MS = 2000;

  let lastMetadataHash = "";
  let updateTimer = null;
  let firstPendingAt = 0;

  function extractVideoId(urlObj) {
    if (urlObj.hostname.includes("youtu.be")) {
      return urlObj.pathname.slice(1).split("/")[0] || null;
    }
    if (urlObj.pathname === "/watch") {
      return urlObj.searchParams.get("v") || null;
    }
    if (urlObj.pathname.startsWith("/shorts/")) {
      return urlObj.pathname.split("/shorts/")[1]?.split("?")[0] || null;
    }
    if (urlObj.pathname.startsWith("/embed/")) {
      return urlObj.pathname.split("/embed/")[1]?.split("?")[0] || null;
    }
    if (urlObj.pathname.startsWith("/live/")) {
      return urlObj.pathname.split("/live/")[1]?.split("?")[0] || null;
    }
    return null;
  }

  function extractTitle() {
    const watchHeader = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata, #title.ytd-watch-metadata");
    if (watchHeader && watchHeader.innerText.trim()) {
      return watchHeader.innerText.trim();
    }

    const metaTitle = document.querySelector('meta[name="title"], meta[property="og:title"]');
    if (metaTitle && metaTitle.content) {
      return metaTitle.content.trim();
    }

    const docTitle = document.title || "";
    const cleaned = docTitle.replace(/ - YouTube$/, "").trim();
    return cleaned !== "YouTube" ? cleaned : "";
  }

  function extractChannelInfo() {
    let channelId = null;
    let channelName = null;

    // 1. Meta tag channel ID
    const metaChannelId = document.querySelector('meta[itemprop="channelId"]');
    if (metaChannelId && metaChannelId.content) {
      channelId = metaChannelId.content.trim();
    }

    // 2. Channel links in DOM
    const channelAnchor = document.querySelector(
      "#owner #channel-name a, ytd-channel-name a, #upload-info #channel-name a, a[href*='/channel/UC']"
    );

    if (channelAnchor) {
      if (!channelName && channelAnchor.innerText.trim()) {
        channelName = channelAnchor.innerText.trim();
      }
      if (!channelId && channelAnchor.href) {
        const match = channelAnchor.href.match(/\/channel\/(UC[^\/\?#]+)/);
        if (match) channelId = match[1];
      }
    }

    // 3. Handle /@channelName
    if (!channelName) {
      const handleAnchor = document.querySelector("a[href*='/@']");
      if (handleAnchor) {
        const href = handleAnchor.getAttribute("href") || "";
        const handleMatch = href.match(/\/@([^\/\?#]+)/);
        if (handleMatch) {
          channelName = handleMatch[1];
        }
      }
    }

    // 4. Fallback meta name
    if (!channelName) {
      const metaName = document.querySelector('span[itemprop="author"] link[itemprop="name"], meta[itemprop="name"]');
      if (metaName && metaName.content) {
        channelName = metaName.content.trim();
      }
    }

    return { channelId, channelName };
  }

  function extractContentType(urlObj) {
    const path = urlObj.pathname;
    if (path.startsWith("/shorts/")) return "shorts";
    if (path.startsWith("/live/")) return "live";
    if (urlObj.searchParams.has("list") || path.startsWith("/playlist")) return "playlist";
    if (path === "/watch") return "video";
    if (path.startsWith("/@") || path.startsWith("/channel/") || path.startsWith("/c/") || path.startsWith("/user/")) {
      return "channel";
    }
    return "home";
  }

  function extractMetadata() {
    try {
      const urlObj = new URL(location.href);
      const videoId = extractVideoId(urlObj);
      const title = extractTitle();
      const { channelId, channelName } = extractChannelInfo();
      const contentType = extractContentType(urlObj);

      return {
        url: location.href,
        domain: "youtube.com",
        videoId,
        title,
        channelId,
        channelName,
        contentType,
        timestamp: Date.now(),
      };
    } catch {
      return null;
    }
  }

  function broadcastMetadata() {
    const metadata = extractMetadata();
    if (!metadata) return;

    const hash = `${metadata.url}::${metadata.videoId}::${metadata.title}::${metadata.channelId}::${metadata.channelName}`;
    if (hash === lastMetadataHash) return;
    lastMetadataHash = hash;

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: "YOUTUBE_METADATA_UPDATE",
        metadata,
      }).catch(() => {
        /* Ignore connection errors when background service worker wakes up */
      });
    }
  }

  function runUpdate() {
    updateTimer = null;
    firstPendingAt = 0;
    broadcastMetadata();
  }

  function scheduleUpdate(delay = 300) {
    const now = Date.now();
    if (!firstPendingAt) firstPendingAt = now;

    // Cap how far the trailing edge can slide, so a steady stream of
    // mutations still gets a broadcast every MAX_UPDATE_DELAY_MS.
    const deadline = firstPendingAt + MAX_UPDATE_DELAY_MS;
    const fireAt = Math.min(now + delay, deadline);

    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(runUpdate, Math.max(0, fireAt - now));
  }

  // SPA Event Listeners
  window.addEventListener("yt-navigate-finish", () => scheduleUpdate(100));
  window.addEventListener("yt-page-data-updated", () => scheduleUpdate(100));
  window.addEventListener("popstate", () => scheduleUpdate(100));
  window.addEventListener("hashchange", () => scheduleUpdate(100));

  // Watch the document title only. The previous version fell back to
  // observing the entire documentElement subtree (including characterData)
  // whenever <title> had not been parsed yet, which on YouTube means being
  // woken by essentially every DOM change on the page.
  const observer = new MutationObserver(() => scheduleUpdate(300));
  function observeTitle() {
    const titleEl = document.querySelector("title");
    if (titleEl) {
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
      return true;
    }
    return false;
  }
  if (!observeTitle() && document.head) {
    // <title> not there yet: watch just <head> until it appears.
    const headObserver = new MutationObserver(() => {
      if (observeTitle()) headObserver.disconnect();
      scheduleUpdate(300);
    });
    headObserver.observe(document.head, { childList: true });
  }

  // Initial Extraction
  scheduleUpdate(0);
  scheduleUpdate(1000); // Secondary check after YouTube dynamic JS renders
})();
