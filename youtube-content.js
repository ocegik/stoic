// ---------- youtube-content.js ----------
// Content script for YouTube pages. Extracts rich video & channel metadata
// and listens for YouTube's SPA navigation events (yt-navigate-finish,
// yt-page-data-updated, DOM mutations) to keep metadata updated live.

(function () {
  let lastMetadataHash = "";
  let updateTimer = null;

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

  function scheduleUpdate(delay = 300) {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      broadcastMetadata();
    }, delay);
  }

  // SPA Event Listeners
  window.addEventListener("yt-navigate-finish", () => scheduleUpdate(100));
  window.addEventListener("yt-page-data-updated", () => scheduleUpdate(100));
  window.addEventListener("popstate", () => scheduleUpdate(100));
  window.addEventListener("hashchange", () => scheduleUpdate(100));

  // DOM MutationObserver for dynamic element loading (title, channel elements)
  const observer = new MutationObserver(() => scheduleUpdate(300));
  const target = document.querySelector("title") || document.documentElement;
  if (target) {
    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // Initial Extraction
  scheduleUpdate(0);
  scheduleUpdate(1000); // Secondary check after YouTube dynamic JS renders
})();
