// ---------- youtube-classifier.js ----------
// The YouTube classification domain service — the single authoritative
// answer to "which category does this watched video belong to?".
//
// Everything that holds an opinion about YouTube lives here: the channel
// database, the per-video database, the prediction providers, the
// precedence rules, and the watch-time attribution that feeds analytics.
// common.js owns the generic taxonomy and the classification framework and
// deliberately knows nothing about YouTube; this module plugs into it
// through two registration hooks (registerClassifierRule for the
// classification pipeline, registerContentService for analytics
// attribution), so the dependency only ever points this way.
//
// Loaded the same two ways as common.js, and always *after* it:
//   - <script src="common.js"></script><script src="youtube-classifier.js">
//     in popup.html / options.html
//   - importScripts("common.js", "youtube-classifier.js") in the worker
//   - require("./youtube-classifier.js") under Node (the test suite)
//
// Unlike common.js this file wraps its body in an IIFE and publishes an
// explicit namespace object. common.js declares its classes and consts
// lexically, which means they are visible to this file as bare identifiers
// but are *not* properties of the global object — so re-declaring any of
// those names at top level here would be a hard SyntaxError. Staying inside
// a function scope keeps the two files from colliding.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // In Node the framework comes from common.js's CommonJS export. In a
  // browser/worker it is already in scope as global lexical bindings, so we
  // capture the ones we need into a plain object. Only one of these two
  // branches is ever evaluated, which is what keeps the bare identifiers in
  // the second branch from blowing up under Node.
  const common =
    typeof module !== "undefined" && module.exports
      ? require("./common.js")
      : {
          ClassificationContext,
          ClassificationResult,
          MICRO_TO_MACRO,
          MICRO_CATEGORIES,
          MACRO_CATEGORIES,
          DEFAULT_MICRO_FOR_MACRO,
          todayStr,
          usageSecondsForDate,
          getDomainTaxonomy,
          registerClassifierRule,
          registerContentService,
          invalidateClassificationCache,
          ClassifierRule,
        };

  const {
    ClassificationContext: Ctx,
    ClassificationResult: Result,
    MICRO_TO_MACRO: MICRO_MAP,
    MICRO_CATEGORIES: MICROS,
    DEFAULT_MICRO_FOR_MACRO: DEFAULT_MICRO,
    todayStr: getTodayKey,
    getDomainTaxonomy: domainTaxonomy,
    registerClassifierRule,
    registerContentService,
    invalidateClassificationCache,
    ClassifierRule: BaseClassifierRule,
  } = common;

  // ==========================================================
  // 1. Constants & taxonomy helpers
  // ==========================================================

  const YT_CHANNELS_KEY = "yt_channels";
  const YT_VIDEOS_KEY = "yt_videos";
  const AI_SETTINGS_KEY = "ai_settings";

  const CHANNEL_STORE_VERSION = 2;

  // Keeps chrome.storage.local bounded. The video database is a rolling log
  // used for prediction context and the debugger view, not an archive.
  const MAX_VIDEOS_RETAINED = 750;
  // Per-day cap on distinct watch-time attribution buckets held on a site
  // entry. Past this, further time folds into the generic "browse" bucket
  // rather than growing the entry without limit.
  const MAX_ATTRIBUTION_KEYS_PER_DAY = 400;

  // Canonical vocabulary for how a channel classification came to be.
  // `manual` and `builtin` are *explicit*: they pin the channel and end the
  // pipeline. `predicted` and `unclassified` are outputs of the prediction
  // system and stay open to being replaced.
  const CHANNEL_SOURCES = {
    MANUAL: "manual",
    BUILTIN: "builtin",
    PREDICTED: "predicted",
    UNCLASSIFIED: "unclassified",
  };

  // Vocabulary written by older builds, normalized on read.
  const LEGACY_SOURCE_MAP = {
    ai: CHANNEL_SOURCES.PREDICTED,
    ai_unclassified: CHANNEL_SOURCES.UNCLASSIFIED,
    ai_channel_database: CHANNEL_SOURCES.PREDICTED,
    manual_channel_database: CHANNEL_SOURCES.MANUAL,
    channel_database: CHANNEL_SOURCES.PREDICTED,
    heuristic_ai: CHANNEL_SOURCES.PREDICTED,
  };

  const UNCLASSIFIED_MICRO = "Unclassified";

  function isYouTubeDomain(domain) {
    const d = String(domain || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    return d === "youtube.com" || d.endsWith(".youtube.com") || d === "youtu.be";
  }

  // Coerces any {macro, micro} pair into a valid taxonomy entry. Custom
  // micro categories are allowed (users can invent them), but the macro is
  // always one of the three the rest of the app knows how to weigh.
  function normalizeClassification(classification) {
    const raw = classification && typeof classification === "object" ? classification : {};
    let micro = typeof raw.micro === "string" && raw.micro.trim() ? raw.micro.trim() : null;
    let macro = typeof raw.macro === "string" && raw.macro.trim() ? raw.macro.trim() : null;

    if (!micro && !macro) return null;
    if (!macro) macro = MICRO_MAP[micro] || "General";
    if (!["Productivity", "General", "Leisure"].includes(macro)) macro = "General";
    if (!micro) micro = DEFAULT_MICRO[macro] || "General Browsing";

    return { macro, micro };
  }

  function isResolvedClassification(classification) {
    const norm = normalizeClassification(classification);
    return !!norm && norm.micro !== UNCLASSIFIED_MICRO;
  }

  function normalizeChannelName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
  }

  // The channel database is keyed by channel ID when YouTube gave us one,
  // and by a `name:` pseudo-key when all we have is a display name or a
  // handle (which is the normal case for a channel a user classifies by
  // hand before ever visiting it). bindChannelIdentity() below merges the
  // two once the real ID shows up.
  function canonicalChannelKey(info) {
    const id = String((info && info.channelId) || "").trim();
    if (id) return id;
    const name = normalizeChannelName(info && info.channelName);
    return name ? `name:${name}` : null;
  }

  // ==========================================================
  // 2. Built-in explicit channel classifications
  // ==========================================================
  //
  // A small shipped table of channels whose category is not really in
  // question. These behave as explicit classifications (they pin, and stop
  // prediction) but sit *below* a user's own manual classification, so
  // anyone who disagrees can simply override and their choice sticks.
  //
  // To extend: add a row keyed by the normalized channel name/handle, or by
  // channel ID. Nothing else needs to change.
  const BUILT_IN_CHANNEL_CLASSIFICATIONS = {
    "freecodecamp.org": { micro: "Coding" },
    freecodecamp: { micro: "Coding" },
    fireship: { micro: "Coding" },
    "the coding train": { micro: "Coding" },
    "traversy media": { micro: "Coding" },
    veritasium: { micro: "Study" },
    "3blue1brown": { micro: "Study" },
    numberphile: { micro: "Study" },
    khanacademy: { micro: "Study" },
    "khan academy": { micro: "Study" },
    physicswallah: { micro: "Study" },
    "kurzgesagt – in a nutshell": { micro: "Research & Reference" },
    ted: { micro: "Research & Reference" },
    mrbeast: { micro: "Entertainment" },
    pewdiepie: { micro: "Entertainment" },
    ign: { micro: "Gaming" },
  };

  function lookupBuiltInChannel(info) {
    const candidates = [
      normalizeChannelName(info && info.channelName),
      String((info && info.channelId) || "").trim(),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const hit = BUILT_IN_CHANNEL_CLASSIFICATIONS[candidate];
      if (hit) {
        return {
          channelId: canonicalChannelKey(info),
          channelName: (info && info.channelName) || candidate,
          classification: normalizeClassification(hit),
          confidence: 1.0,
          reason: "Built-in default classification shipped with Stoic",
          source: CHANNEL_SOURCES.BUILTIN,
          pinned: true,
          updatedAt: null,
        };
      }
    }
    return null;
  }

  // ==========================================================
  // 3. Channel store
  // ==========================================================
  //
  // Persisted shape (chrome.storage.local["yt_channels"]):
  //   { __v: 2, channels: { [key]: record }, aliases: { [name]: key } }
  //
  // Exactly one record per channel. Older builds wrote the same record
  // under both its ID and its name, which meant a channel classified by
  // name never bound to the ID the content script later reported — the
  // user's manual classification was silently ignored from then on.
  // migrateChannelStore() collapses those duplicates on first read.

  const hasChromeStorage = () =>
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  function emptyChannelStore() {
    return { __v: CHANNEL_STORE_VERSION, channels: {}, aliases: {} };
  }

  function normalizeChannelRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    const key = canonicalChannelKey(raw);
    if (!key) return null;

    const source = LEGACY_SOURCE_MAP[raw.source] || raw.source || CHANNEL_SOURCES.PREDICTED;
    const classification = normalizeClassification(raw.classification);
    const isExplicit = source === CHANNEL_SOURCES.MANUAL || source === CHANNEL_SOURCES.BUILTIN;

    return {
      channelId: key,
      channelName: raw.channelName || raw.channelId || key.replace(/^name:/, ""),
      classification: classification || { macro: "General", micro: UNCLASSIFIED_MICRO },
      confidence: typeof raw.confidence === "number" ? raw.confidence : isExplicit ? 1.0 : 0.85,
      reason: raw.reason || "",
      // `pinned` is the single flag the resolver checks for "explicit".
      // Legacy records only carried a source, so derive it from that.
      pinned: typeof raw.pinned === "boolean" ? raw.pinned : isExplicit,
      source: classification && classification.micro === UNCLASSIFIED_MICRO && !isExplicit
        ? CHANNEL_SOURCES.UNCLASSIFIED
        : source,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      // Prediction bookkeeping: lets predictChannelClassification() avoid
      // re-running the exact same losing prediction on every single video.
      predictionSignature: raw.predictionSignature || null,
      predictionAttempts: Number(raw.predictionAttempts) || 0,
    };
  }

  function indexAlias(store, record) {
    const name = normalizeChannelName(record.channelName);
    if (name) store.aliases[name] = record.channelId;
  }

  function migrateChannelStore(raw) {
    if (raw && raw.__v === CHANNEL_STORE_VERSION && raw.channels) {
      const store = emptyChannelStore();
      Object.values(raw.channels).forEach((rec) => {
        const record = normalizeChannelRecord(rec);
        if (record) {
          store.channels[record.channelId] = record;
          indexAlias(store, record);
        }
      });
      Object.assign(store.aliases, raw.aliases || {});
      return store;
    }

    // Legacy flat map, potentially with the same record under two keys.
    const store = emptyChannelStore();
    Object.values(raw || {}).forEach((rec) => {
      const record = normalizeChannelRecord(rec);
      if (!record) return;
      const existing = store.channels[record.channelId];
      // Prefer whichever copy carries an explicit (user) classification.
      if (!existing || (record.pinned && !existing.pinned)) {
        store.channels[record.channelId] = record;
      }
      indexAlias(store, store.channels[record.channelId]);
    });
    return store;
  }

  // Synchronous snapshots. Classification has to be answerable synchronously
  // (analytics, the pipeline, and every render path are sync), so both
  // stores are mirrored in memory, primed at startup and kept fresh by the
  // storage.onChanged listener at the bottom of this file. That listener is
  // also what makes a manual override in the options page take effect in the
  // service worker and the popup without any explicit message passing.
  let channelStoreSnapshot = emptyChannelStore();
  let videoDbSnapshot = {};
  let storesPrimed = false;

  function getChannelStoreSync() {
    return channelStoreSnapshot;
  }

  async function getChannelStore() {
    if (hasChromeStorage()) {
      const { [YT_CHANNELS_KEY]: raw } = await chrome.storage.local.get(YT_CHANNELS_KEY);
      channelStoreSnapshot = migrateChannelStore(raw);
    }
    return channelStoreSnapshot;
  }

  async function saveChannelStore(store) {
    channelStoreSnapshot = store && store.channels ? store : emptyChannelStore();
    invalidateClassificationCache();
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [YT_CHANNELS_KEY]: channelStoreSnapshot });
    }
    return channelStoreSnapshot;
  }

  // Pure lookup against a store snapshot: by canonical key, then by name
  // alias. Used by every sync path (pipeline rules, attribution).
  function lookupChannelIn(store, info) {
    if (!store || !store.channels) return null;
    const key = canonicalChannelKey(info);
    if (key && store.channels[key]) return store.channels[key];

    const name = normalizeChannelName(info && info.channelName);
    if (name) {
      const aliasKey = store.aliases ? store.aliases[name] : null;
      if (aliasKey && store.channels[aliasKey]) return store.channels[aliasKey];
      if (store.channels[`name:${name}`]) return store.channels[`name:${name}`];
    }

    // A caller may pass a bare name in the channelId slot (older UI did).
    const idAsName = normalizeChannelName(info && info.channelId);
    if (idAsName) {
      const aliasKey = store.aliases ? store.aliases[idAsName] : null;
      if (aliasKey && store.channels[aliasKey]) return store.channels[aliasKey];
      if (store.channels[`name:${idAsName}`]) return store.channels[`name:${idAsName}`];
    }
    return null;
  }

  function lookupChannelSync(info) {
    return lookupChannelIn(getChannelStoreSync(), info);
  }

  async function getChannel(channelIdOrName) {
    if (!channelIdOrName) return null;
    const store = await getChannelStore();
    return (
      lookupChannelIn(store, { channelId: channelIdOrName }) ||
      lookupChannelIn(store, { channelName: channelIdOrName })
    );
  }

  function listChannels(store = getChannelStoreSync()) {
    return Object.values((store && store.channels) || {}).sort(
      (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
    );
  }

  // When a record was created from a name alone and the real channel ID
  // shows up later, re-key the record so the user's classification keeps
  // applying instead of a duplicate being predicted alongside it.
  function bindChannelIdentity(store, info) {
    const realId = String((info && info.channelId) || "").trim();
    if (!realId || store.channels[realId]) return null;

    const name = normalizeChannelName(info && info.channelName);
    if (!name) return null;
    const legacyKey = (store.aliases && store.aliases[name]) || `name:${name}`;
    const legacy = store.channels[legacyKey];
    if (!legacy || legacy.channelId === realId) return null;

    delete store.channels[legacyKey];
    const rebound = { ...legacy, channelId: realId, channelName: info.channelName || legacy.channelName };
    store.channels[realId] = rebound;
    indexAlias(store, rebound);
    return rebound;
  }

  // The single write path for channel records. Everything — manual
  // overrides, predictions, identity binding — goes through here.
  async function upsertChannel(input, { merge = true } = {}) {
    const key = canonicalChannelKey(input);
    if (!key) return null;

    const store = await getChannelStore();
    bindChannelIdentity(store, input);

    const existing = lookupChannelIn(store, input);
    const base = merge && existing ? existing : {};
    const record = normalizeChannelRecord({
      ...base,
      ...input,
      // A real channel ID always wins over a `name:` placeholder key.
      channelId: String(input.channelId || "").trim() || (existing && existing.channelId) || key,
      channelName: input.channelName || (existing && existing.channelName) || null,
      updatedAt: input.updatedAt || new Date().toISOString(),
    });
    if (!record) return null;

    if (existing && existing.channelId !== record.channelId) {
      delete store.channels[existing.channelId];
    }
    store.channels[record.channelId] = record;
    indexAlias(store, record);
    await saveChannelStore(store);
    return record;
  }

  // Manual override entry point: pins the channel so the resolver treats it
  // as explicit and stops predicting for it.
  async function setChannelClassification(info, classification, options = {}) {
    const normalized = normalizeClassification(classification);
    if (!normalized) return null;
    return upsertChannel({
      channelId: info.channelId,
      channelName: info.channelName,
      classification: normalized,
      confidence: 1.0,
      reason: options.reason || "Manual classification set in the YouTube debugger",
      source: CHANNEL_SOURCES.MANUAL,
      pinned: true,
      predictionSignature: null,
      predictionAttempts: 0,
    });
  }

  // Drops the explicit pin and hands the channel back to the prediction
  // system (the record itself is removed so the next visit re-predicts).
  async function unpinChannel(info) {
    const store = await getChannelStore();
    const existing = lookupChannelIn(store, info);
    if (!existing) return null;
    delete store.channels[existing.channelId];
    Object.keys(store.aliases || {}).forEach((name) => {
      if (store.aliases[name] === existing.channelId) delete store.aliases[name];
    });
    await saveChannelStore(store);
    return existing;
  }

  const deleteChannel = unpinChannel;

  async function clearChannelStore() {
    return saveChannelStore(emptyChannelStore());
  }

  // ==========================================================
  // 4. Video store
  // ==========================================================
  //
  // Videos are logged for two reasons: they give the channel predictor a
  // richer title profile, and they are the unit a user can override
  // individually. `override` is the per-video explicit classification.

  function getVideoDatabaseSync() {
    return videoDbSnapshot;
  }

  async function getVideoDatabase() {
    if (hasChromeStorage()) {
      const { [YT_VIDEOS_KEY]: videos = {} } = await chrome.storage.local.get(YT_VIDEOS_KEY);
      videoDbSnapshot = videos || {};
    }
    return videoDbSnapshot;
  }

  // Keeps the log bounded by dropping the least recently seen videos.
  function pruneVideoDatabase(db) {
    const keys = Object.keys(db);
    if (keys.length <= MAX_VIDEOS_RETAINED) return db;
    const ordered = keys.sort(
      (a, b) => new Date(db[b].updatedAt || 0) - new Date(db[a].updatedAt || 0)
    );
    const pruned = {};
    ordered.slice(0, MAX_VIDEOS_RETAINED).forEach((k) => {
      pruned[k] = db[k];
    });
    // Never prune a video the user explicitly classified.
    ordered.slice(MAX_VIDEOS_RETAINED).forEach((k) => {
      if (db[k] && db[k].override) pruned[k] = db[k];
    });
    return pruned;
  }

  async function saveVideoDatabase(videos) {
    videoDbSnapshot = pruneVideoDatabase(videos || {});
    invalidateClassificationCache();
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [YT_VIDEOS_KEY]: videoDbSnapshot });
    }
    return videoDbSnapshot;
  }

  async function getVideo(videoId) {
    if (!videoId) return null;
    const db = await getVideoDatabase();
    return db[videoId] || null;
  }

  async function saveVideo(videoData) {
    if (!videoData || !videoData.videoId) return null;
    const db = await getVideoDatabase();
    const existing = db[videoData.videoId] || {};
    const updated = {
      videoId: videoData.videoId,
      title: videoData.title || existing.title || "",
      channelId: videoData.channelId || existing.channelId || null,
      channelName: videoData.channelName || existing.channelName || null,
      contentType: videoData.contentType || existing.contentType || "video",
      override:
        videoData.override !== undefined
          ? normalizeClassification(videoData.override)
          : existing.override || null,
      overrideAt: videoData.override !== undefined ? new Date().toISOString() : existing.overrideAt || null,
      updatedAt: videoData.updatedAt || new Date().toISOString(),
    };
    db[videoData.videoId] = updated;
    await saveVideoDatabase(db);
    return updated;
  }

  async function setVideoOverride(videoId, classification) {
    if (!videoId) return null;
    const db = await getVideoDatabase();
    if (!db[videoId]) return null;
    return saveVideo({ ...db[videoId], override: classification ? normalizeClassification(classification) : null });
  }

  async function clearVideoDatabase() {
    return saveVideoDatabase({});
  }

  // ==========================================================
  // 5. Prediction settings & providers
  // ==========================================================

  const DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.7;
  const DEFAULT_AI_SETTINGS = {
    provider: "heuristic", // "heuristic" | "custom_api"
    apiKey: "",
    apiEndpoint: "",
    confidenceThreshold: DEFAULT_AI_CONFIDENCE_THRESHOLD,
    autoClassify: true,
  };

  let inMemoryAISettings = null;

  async function getAISettings() {
    if (hasChromeStorage()) {
      const { [AI_SETTINGS_KEY]: settings } = await chrome.storage.local.get(AI_SETTINGS_KEY);
      inMemoryAISettings = { ...DEFAULT_AI_SETTINGS, ...(settings || {}) };
      return inMemoryAISettings;
    }
    return inMemoryAISettings
      ? { ...DEFAULT_AI_SETTINGS, ...inMemoryAISettings }
      : { ...DEFAULT_AI_SETTINGS };
  }

  async function saveAISettings(settings) {
    const updated = { ...DEFAULT_AI_SETTINGS, ...settings };
    inMemoryAISettings = updated;
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [AI_SETTINGS_KEY]: updated });
    }
    return updated;
  }

  // The keyword ladder behind the local heuristic provider, expressed as
  // data so a new topic is one row rather than another `else if`. Order is
  // significance order — the first match wins (tech tutorials should land
  // on Coding rather than the broader Study bucket, for instance).
  const HEURISTIC_RULES = [
    {
      micro: "Coding",
      confidence: 0.92,
      reason: "Software development, programming, or coding keywords detected",
      pattern:
        /code|coding|programmer|programming|developer|dev|javascript|python|react|node|rust|c\+\+|java|github|leetcode|framework|html|css|webdev|fireship|traversy|freecodecamp/i,
    },
    {
      micro: "Study",
      confidence: 0.9,
      reason: "Educational, academic, or tutorial keywords detected in channel/video context",
      pattern:
        /coursera|udemy|edx|lecture|course|tutorial|learn|university|academy|math|physics|algebra|calculus|geometry|biology|chemistry|science|history|philosophy|khan|veritasium|31415|3blue1brown|numberphile|mit|stanford|harvard|pw\.live|physicswallah/i,
    },
    {
      micro: "AI & Chatbots",
      confidence: 0.88,
      reason: "Artificial intelligence or LLM topics detected",
      pattern:
        /chatgpt|openai|llm|ai news|artificial intelligence|machine learning|deep learning|prompt|gpt-4|claude|gemini/i,
    },
    {
      micro: "Research & Reference",
      confidence: 0.85,
      reason: "Research, documentary, or analytical content keywords detected",
      pattern: /paper|arxiv|research|documentary|TED|tedx|essay|analysis|deep dive|explainer/i,
    },
    {
      micro: "News",
      confidence: 0.88,
      reason: "News, reporting, or current events topics detected",
      pattern: /news|daily|report|politics|breaking|bulletin|bbc|cnn|reuters|journal|vox/i,
    },
    {
      micro: "Gaming",
      confidence: 0.9,
      reason: "Gaming, walkthrough, or esports keywords detected",
      pattern:
        /gameplay|walkthrough|playthrough|ign|nintendo|playstation|xbox|minecraft|roblox|fortnite|esports|speedrun|twitch/i,
    },
    {
      micro: "Streaming",
      confidence: 0.85,
      reason: "General entertainment, music, or vlog content detected",
      pattern:
        /vlog|music|official video|trailer|movie|show|comedy|sketch|reaction|funny|highlights|podcast|clip|entertainment/i,
    },
  ];

  // The synchronous core of the heuristic. Shared by the async channel
  // provider and by the per-video prediction step, so the two can never
  // drift apart.
  function predictFromText(text) {
    const haystack = String(text || "").toLowerCase();
    if (!haystack.trim()) return null;
    for (const rule of HEURISTIC_RULES) {
      if (rule.pattern.test(haystack)) {
        return {
          macro: MICRO_MAP[rule.micro] || "General",
          micro: rule.micro,
          confidence: rule.confidence,
          reason: rule.reason,
        };
      }
    }
    return null;
  }

  class BaseChannelPredictionProvider {
    constructor(name = "base") {
      this.name = name;
    }

    // Returns { macro, micro, confidence, reason } or null. Deciding what
    // to do with a low-confidence answer is the service's job, not the
    // provider's.
    async classifyChannel() {
      return null;
    }
  }

  class HeuristicAIClassifierProvider extends BaseChannelPredictionProvider {
    constructor() {
      super("heuristic");
    }

    async classifyChannel(channelInfo = {}) {
      const name = String(channelInfo.channelName || channelInfo.channelId || "");
      const primaryTitle = String(channelInfo.videoTitle || channelInfo.title || "");
      const extraTitles = Array.isArray(channelInfo.videoTitles) ? channelInfo.videoTitles.map(String) : [];
      const allTitles = [primaryTitle, ...extraTitles].filter(Boolean);
      const hit = predictFromText(`${name} ${allTitles.join(" ")}`);

      if (hit) {
        return {
          ...hit,
          reason:
            allTitles.length > 1
              ? `${hit.reason} (analyzed ${allTitles.length} recent channel titles)`
              : hit.reason,
        };
      }

      return {
        macro: "General",
        micro: UNCLASSIFIED_MICRO,
        confidence: 0.5,
        reason: "No high-confidence channel topics identified from current metadata",
      };
    }
  }

  class CustomAPIClassifierProvider extends BaseChannelPredictionProvider {
    constructor({ name = "custom_api", apiKey = "", endpoint = "" } = {}) {
      super(name);
      this.apiKey = apiKey;
      this.endpoint = endpoint;
      this.fallback = new HeuristicAIClassifierProvider();
    }

    async classifyChannel(channelInfo = {}) {
      if (!this.apiKey || !this.endpoint) {
        return this.fallback.classifyChannel(channelInfo);
      }
      const titlesList =
        Array.isArray(channelInfo.videoTitles) && channelInfo.videoTitles.length > 0
          ? channelInfo.videoTitles.join("; ")
          : channelInfo.videoTitle || "";

      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            prompt: `Classify YouTube channel "${
              channelInfo.channelName || channelInfo.channelId
            }" based on video titles: [${titlesList}]. Return JSON with macro and micro category.`,
          }),
        });
        const data = await res.json();
        if (data && data.micro) {
          return {
            macro: data.macro || MICRO_MAP[data.micro] || "General",
            micro: data.micro,
            confidence: typeof data.confidence === "number" ? data.confidence : 0.9,
            reason: data.reason || "Remote API classification",
          };
        }
      } catch (err) {
        console.error("[Stoic YouTube] Remote prediction failed, using local heuristic:", err);
      }
      return this.fallback.classifyChannel(channelInfo);
    }
  }

  class AIClassifierRegistry {
    constructor() {
      this.provider = new HeuristicAIClassifierProvider();
    }

    setProvider(provider) {
      if (provider && typeof provider.classifyChannel === "function") {
        this.provider = provider;
      }
    }

    getProvider() {
      return this.provider;
    }

    async classifyChannel(channelInfo) {
      return this.provider.classifyChannel(channelInfo);
    }
  }

  const defaultAIClassifierRegistry = new AIClassifierRegistry();

  // ==========================================================
  // 6. Prediction orchestration
  // ==========================================================

  const inFlightPredictions = new Map();

  function titlesForChannel(videoDb, info) {
    const id = String((info && info.channelId) || "").trim();
    const name = normalizeChannelName(info && info.channelName);
    return Object.values(videoDb || {})
      .filter((v) => {
        if (!v) return false;
        if (id && v.channelId === id) return true;
        if (name && normalizeChannelName(v.channelName) === name) return true;
        return false;
      })
      .map((v) => v.title)
      .filter(Boolean)
      .slice(-10);
  }

  // A cheap fingerprint of the evidence a prediction was made from. If it
  // has not changed there is nothing new to learn, so an unresolved channel
  // is not re-predicted on every single video view.
  function predictionSignature(titles) {
    return `${titles.length}:${titles.join("|").slice(0, 240)}`;
  }

  async function predictChannelClassification(metadata, options = {}) {
    if (!metadata) return null;
    const info = {
      channelId: metadata.channelId || null,
      channelName: metadata.channelName || null,
    };
    if (!info.channelId && !info.channelName) return null;

    const force = options.forceReclassify === true;
    const settings = await getAISettings();
    const autoClassify = options.autoClassify !== undefined ? options.autoClassify : settings.autoClassify;

    const store = await getChannelStore();
    // Do this before any early return: discovering the real channel ID for a
    // record that was created from a name alone is bookkeeping that must
    // happen even when we then decline to predict over it.
    const rebound = bindChannelIdentity(store, info);
    if (rebound) await saveChannelStore(store);

    const existing = lookupChannelIn(store, info);

    if (!autoClassify && !force) return existing;

    // 1. An explicit classification is final. Prediction never overwrites a
    //    user's decision unless the user explicitly asks for a re-run.
    if (existing && existing.pinned && !force) return existing;

    // 2. A settled prediction is reused indefinitely.
    if (existing && !force && existing.source === CHANNEL_SOURCES.PREDICTED && isResolvedClassification(existing.classification)) {
      return existing;
    }

    const key = canonicalChannelKey(info);
    if (inFlightPredictions.has(key)) return inFlightPredictions.get(key);

    const run = (async () => {
      try {
        const videoDb = await getVideoDatabase();
        const titles = titlesForChannel(videoDb, info);
        const currentTitle = metadata.title || metadata.videoTitle || "";
        if (currentTitle && !titles.includes(currentTitle)) titles.push(currentTitle);

        // 3. Nothing new to go on since the last unresolved attempt.
        const signature = predictionSignature(titles);
        if (
          existing &&
          !force &&
          existing.source === CHANNEL_SOURCES.UNCLASSIFIED &&
          existing.predictionSignature === signature
        ) {
          return existing;
        }

        let provider = options.provider;
        if (!provider) {
          provider =
            settings.provider === "custom_api" && settings.apiKey && settings.apiEndpoint
              ? new CustomAPIClassifierProvider({ apiKey: settings.apiKey, endpoint: settings.apiEndpoint })
              : defaultAIClassifierRegistry.getProvider();
        }

        const threshold =
          options.confidenceThreshold !== undefined
            ? options.confidenceThreshold
            : settings.confidenceThreshold !== undefined
            ? settings.confidenceThreshold
            : DEFAULT_AI_CONFIDENCE_THRESHOLD;

        const maxAttempts = options.maxRetries || 2;
        let prediction = null;
        let attempts = 0;
        while (attempts < maxAttempts) {
          try {
            prediction = await provider.classifyChannel({
              channelId: info.channelId,
              channelName: info.channelName,
              videoTitle: currentTitle,
              videoTitles: titles,
              contentType: metadata.contentType || "video",
              url: metadata.url || "",
            });
            if (prediction) break;
          } catch (err) {
            attempts++;
            if (attempts >= maxAttempts) throw err;
            await new Promise((r) => setTimeout(r, 150 * attempts));
          }
        }

        if (!prediction) return existing || null;

        const confident = Number(prediction.confidence) >= threshold;
        const classification = confident
          ? normalizeClassification(prediction)
          : { macro: "General", micro: UNCLASSIFIED_MICRO };

        return upsertChannel({
          channelId: info.channelId,
          channelName: info.channelName,
          classification,
          confidence: typeof prediction.confidence === "number" ? prediction.confidence : 0.85,
          reason: confident
            ? prediction.reason || "Prediction from channel and video metadata"
            : `Prediction below the ${Math.round(threshold * 100)}% confidence threshold — left unclassified`,
          source: confident ? CHANNEL_SOURCES.PREDICTED : CHANNEL_SOURCES.UNCLASSIFIED,
          pinned: false,
          predictionSignature: signature,
          predictionAttempts: ((existing && existing.predictionAttempts) || 0) + 1,
        });
      } catch (err) {
        console.error("[Stoic YouTube] Channel prediction error:", err);
        return existing || null;
      } finally {
        inFlightPredictions.delete(key);
      }
    })();

    inFlightPredictions.set(key, run);
    return run;
  }

  // ==========================================================
  // 7. Resolution — the authoritative precedence chain
  // ==========================================================
  //
  // Every consumer in the app (the pipeline, watch-time attribution, the
  // debugger inspector) funnels through this one function, so there is
  // exactly one definition of what a YouTube video's category is.
  //
  //   1. explicit video override   — the user classified this exact video
  //   2. explicit channel (manual) — the user pinned the channel
  //   3. explicit channel (builtin)— shipped default for a known channel
  //   4. site-level user override  — the user categorised youtube.com itself
  //   5. predicted channel         — prediction system, settled result
  //   6. predicted video           — heuristic on this video's own title
  //   -> null: caller falls through to the generic domain rule.
  //
  // Steps 1–3 are "explicit": they end the chain with no prediction at all.

  function siteOverrideFor(sites, domain) {
    if (!sites) return null;
    const entry = sites[domain] || sites["youtube.com"] || null;
    if (!entry) return null;
    const micro = entry.microCategory || entry.category || null;
    const macro = entry.macroCategory || null;
    if (!micro && !macro) return null;
    return normalizeClassification({ macro, micro });
  }

  function resolveYouTubeClassification(input = {}, options = {}) {
    const store = options.channelStore || getChannelStoreSync();
    const videoDb = options.videoDb || getVideoDatabaseSync();
    const sites = options.sites || null;
    const trace = [];

    const record = (step, status, detail) => trace.push({ step, status, detail: detail || null });
    const finish = (result) => ({ result, trace });

    const hasChannel = !!(input.channelId || input.channelName);
    const video = input.videoId ? videoDb[input.videoId] : null;

    // 1. Explicit per-video override.
    if (video && video.override) {
      record("video_override", "hit", `${video.override.macro} · ${video.override.micro}`);
      return finish(
        new Result({
          ...video.override,
          confidence: 1.0,
          source: "manual_video",
          metadata: { videoId: input.videoId, explicit: true, reason: "Manual override on this video" },
        })
      );
    }
    record("video_override", input.videoId ? "miss" : "skipped", input.videoId ? null : "No video ID in context");

    // 2 & 3. Explicit channel classification — final, no prediction.
    const channelInfo = {
      channelId: input.channelId || (video && video.channelId) || null,
      channelName: input.channelName || (video && video.channelName) || null,
    };
    const stored = channelInfo.channelId || channelInfo.channelName ? lookupChannelIn(store, channelInfo) : null;

    if (stored && stored.pinned && isResolvedClassification(stored.classification)) {
      record("explicit_channel", "hit", `${stored.classification.macro} · ${stored.classification.micro}`);
      return finish(
        new Result({
          ...normalizeClassification(stored.classification),
          confidence: 1.0,
          source: stored.source === CHANNEL_SOURCES.BUILTIN ? "builtin_channel" : "manual_channel",
          metadata: {
            channelId: stored.channelId,
            channelName: stored.channelName,
            reason: stored.reason,
            explicit: true,
            updatedAt: stored.updatedAt,
          },
        })
      );
    }

    const builtIn = !stored && (channelInfo.channelId || channelInfo.channelName) ? lookupBuiltInChannel(channelInfo) : null;
    if (builtIn) {
      record("explicit_channel", "hit", `built-in · ${builtIn.classification.micro}`);
      return finish(
        new Result({
          ...builtIn.classification,
          confidence: 1.0,
          source: "builtin_channel",
          metadata: {
            channelId: builtIn.channelId,
            channelName: builtIn.channelName,
            reason: builtIn.reason,
            explicit: true,
          },
        })
      );
    }
    record("explicit_channel", hasChannel ? "miss" : "skipped", hasChannel ? null : "No channel in context");

    // 4. Site-level user override on youtube.com.
    const siteOverride = siteOverrideFor(sites, input.domain || "youtube.com");
    if (siteOverride) {
      record("site_override", "hit", `${siteOverride.macro} · ${siteOverride.micro}`);
      return finish(
        new Result({
          ...siteOverride,
          confidence: 1.0,
          source: "user_override",
          metadata: { reason: "Category set on youtube.com in the website audit" },
        })
      );
    }
    record("site_override", "miss");

    // 5. Settled prediction on the channel.
    if (stored && isResolvedClassification(stored.classification)) {
      record("predicted_channel", "hit", `${stored.classification.macro} · ${stored.classification.micro}`);
      return finish(
        new Result({
          ...normalizeClassification(stored.classification),
          confidence: typeof stored.confidence === "number" ? stored.confidence : 0.85,
          source: "predicted_channel",
          metadata: {
            channelId: stored.channelId,
            channelName: stored.channelName,
            reason: stored.reason,
            explicit: false,
            updatedAt: stored.updatedAt,
          },
        })
      );
    }
    record("predicted_channel", stored ? "unclassified" : "miss", stored ? stored.reason : null);

    // 6. Fall back to this video's own title. A mixed or not-yet-predicted
    //    channel still gets a better answer than "all YouTube is leisure".
    const title = input.title || (video && video.title) || "";
    const fromTitle = predictFromText(title);
    if (fromTitle) {
      record("predicted_video", "hit", `${fromTitle.macro} · ${fromTitle.micro}`);
      return finish(
        new Result({
          macro: fromTitle.macro,
          micro: fromTitle.micro,
          // A single title is weaker evidence than a whole channel profile.
          confidence: Math.max(0.6, fromTitle.confidence - 0.15),
          source: "predicted_video",
          metadata: { videoId: input.videoId || null, reason: `${fromTitle.reason} (from this video's title)` },
        })
      );
    }
    record("predicted_video", title ? "miss" : "skipped", title ? null : "No video title available");

    record("domain_rule", "fallthrough", "Generic youtube.com classification applies");
    return finish(null);
  }

  function explainYouTubeClassification(input, options) {
    const { result, trace } = resolveYouTubeClassification(input, options);
    if (result) return { result, trace };
    const fallback = domainTaxonomy(input.domain || "youtube.com", (options && options.sites) || null);
    return {
      result: new Result({ ...fallback, confidence: 0.8, source: "domain_rule" }),
      trace,
    };
  }

  // ==========================================================
  // 8. Pipeline integration
  // ==========================================================
  //
  // One rule, registered ahead of the generic user-override rule. It owns
  // the whole YouTube precedence chain (including where the site-level
  // override sits within it), which is why there is no second YouTube rule
  // further down the pipeline to keep in sync.

  class YouTubeClassifierRule extends BaseClassifierRule {
    constructor(options = {}) {
      super("youtube");
      this.options = options;
    }

    classify(context, sites = null) {
      if (!context || !isYouTubeDomain(context.domain)) return null;
      const { result } = resolveYouTubeClassification(
        {
          domain: context.domain,
          videoId: context.videoId,
          channelId: context.channelId || (context.metadata && context.metadata.channelId) || null,
          channelName: context.channelName || (context.metadata && context.metadata.channelName) || null,
          title: context.title,
          contentType: context.contentType,
        },
        {
          sites,
          // Tests and the debugger can inject a store explicitly; everything
          // else reads the live snapshot.
          channelStore: (context.metadata && context.metadata.channelStore) || this.options.channelStore,
          videoDb: (context.metadata && context.metadata.videoDb) || this.options.videoDb,
        }
      );
      return result;
    }
  }

  // Priority 10 puts this ahead of UserOverrideClassifierRule (20) — an
  // explicit channel classification outranks a blanket category on
  // youtube.com, while the rule itself still honours that site-level
  // override at step 4 of its chain.
  registerClassifierRule(new YouTubeClassifierRule(), 10);

  // ==========================================================
  // 9. Watch-time attribution
  // ==========================================================
  //
  // Classification only matters if the time follows it. Tracking credits
  // each tick to an *attribution key* rather than to a category, and the
  // category is resolved at read time — so re-classifying a channel
  // retroactively corrects today's analytics instead of only affecting
  // whatever is watched next.
  //
  // Shape on the site entry:
  //   entry.youtube = { date: "YYYY-MM-DD", keys: { "v:<id>": seconds, ... } }

  const BROWSE_KEY = "browse";

  function attributionKeyForContext(context) {
    if (!context) return BROWSE_KEY;
    if (context.videoId) return `v:${context.videoId}`;
    const channelKey = canonicalChannelKey(context);
    if (channelKey) return `c:${channelKey}`;
    return BROWSE_KEY;
  }

  // Mutates `entry` in place, mirroring how the rest of the tracking code
  // works. Returns the key the time was actually credited to.
  function creditYouTubeSeconds(entry, key, seconds, dayKey = getTodayKey()) {
    if (!entry || !(seconds > 0)) return null;
    if (!entry.youtube || entry.youtube.date !== dayKey || typeof entry.youtube.keys !== "object") {
      entry.youtube = { date: dayKey, keys: {} };
    }
    const keys = entry.youtube.keys;
    let target = key || BROWSE_KEY;
    if (keys[target] === undefined && Object.keys(keys).length >= MAX_ATTRIBUTION_KEYS_PER_DAY) {
      target = BROWSE_KEY;
    }
    keys[target] = (keys[target] || 0) + seconds;
    return target;
  }

  function attributionMapFor(entry, dayKey) {
    if (!entry) return null;
    if (entry.youtube && entry.youtube.date === dayKey && entry.youtube.keys) return entry.youtube.keys;
    const archived = (entry.history || []).find((h) => h && h.date === dayKey && h.youtube);
    return archived ? archived.youtube : null;
  }

  // Resolves one attribution key back to a category, using exactly the same
  // precedence chain live classification uses.
  function classificationForKey(key, options) {
    if (!key || key === BROWSE_KEY) return null;
    if (key.startsWith("v:")) {
      const videoId = key.slice(2);
      const video = (options.videoDb || getVideoDatabaseSync())[videoId] || null;
      const { result } = resolveYouTubeClassification(
        {
          videoId,
          channelId: video ? video.channelId : null,
          channelName: video ? video.channelName : null,
          title: video ? video.title : "",
        },
        options
      );
      return result;
    }
    if (key.startsWith("c:")) {
      const channelKey = key.slice(2);
      const info = channelKey.startsWith("name:")
        ? { channelName: channelKey.slice(5) }
        : { channelId: channelKey };
      const { result } = resolveYouTubeClassification(info, options);
      return result;
    }
    return null;
  }

  // Splits a YouTube site entry's time for `dayKey` into taxonomy segments.
  // Returns null when there is nothing attributed, so the caller can keep
  // using the plain domain classification.
  function resolveYouTubeSegments(domain, entry, dayKey, totalSeconds, sites, options = {}) {
    const map = attributionMapFor(entry, dayKey);
    if (!map || totalSeconds <= 0) return null;

    const opts = {
      sites,
      channelStore: options.channelStore || getChannelStoreSync(),
      videoDb: options.videoDb || getVideoDatabaseSync(),
    };
    const fallback = domainTaxonomy(domain, sites);
    const buckets = new Map();
    let attributed = 0;

    const addTo = (macro, micro, seconds, source) => {
      if (!(seconds > 0)) return;
      const bucketKey = `${macro}|${micro}`;
      const bucket = buckets.get(bucketKey) || { macro, micro, seconds: 0, sources: new Set() };
      bucket.seconds += seconds;
      if (source) bucket.sources.add(source);
      buckets.set(bucketKey, bucket);
    };

    Object.keys(map).forEach((key) => {
      const seconds = Number(map[key]) || 0;
      if (seconds <= 0) return;
      attributed += seconds;
      const resolved = classificationForKey(key, opts);
      if (resolved) addTo(resolved.macro, resolved.micro, seconds, resolved.source);
      else addTo(fallback.macro, fallback.micro, seconds, "domain_rule");
    });

    if (attributed <= 0) return null;

    // Attribution is credited from the same elapsed-time readings as
    // usedSeconds, but the two can drift apart (a tick that lands while the
    // metadata is mid-refresh, an imported entry). Scale down if we somehow
    // attributed more than the day's total, and park any shortfall on the
    // generic domain category rather than inventing time.
    let segments = Array.from(buckets.values()).map((b) => ({
      macro: b.macro,
      micro: b.micro,
      seconds: b.seconds,
      sources: Array.from(b.sources),
    }));

    if (attributed > totalSeconds) {
      const scale = totalSeconds / attributed;
      segments = segments.map((s) => ({ ...s, seconds: s.seconds * scale }));
    } else if (attributed < totalSeconds) {
      const remainder = totalSeconds - attributed;
      const existing = segments.find((s) => s.macro === fallback.macro && s.micro === fallback.micro);
      if (existing) existing.seconds += remainder;
      else
        segments.push({
          macro: fallback.macro,
          micro: fallback.micro,
          seconds: remainder,
          sources: ["domain_rule"],
        });
    }

    return segments.filter((s) => s.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  }

  // Registered with common.js so analytics can split YouTube time without
  // knowing anything about channels, videos, or predictions.
  registerContentService({
    name: "youtube",
    handlesDomain: isYouTubeDomain,
    resolveSegments: resolveYouTubeSegments,
    prime: () => ensureYouTubeStoresLoaded(),
  });

  // Convenience roll-up for the debugger: today's YouTube time by category
  // across every tracked YouTube domain.
  function youtubeCategoryTotals(sites, dayKey = getTodayKey()) {
    const totals = new Map();
    let totalSeconds = 0;

    Object.keys(sites || {}).forEach((domain) => {
      if (!isYouTubeDomain(domain)) return;
      const entry = sites[domain];
      const seconds = common.usageSecondsForDate(entry, dayKey, dayKey);
      if (seconds <= 0) return;
      totalSeconds += seconds;
      const segments =
        resolveYouTubeSegments(domain, entry, dayKey, seconds, sites) ||
        [{ ...domainTaxonomy(domain, sites), seconds, sources: ["domain_rule"] }];
      segments.forEach((seg) => {
        const key = `${seg.macro}|${seg.micro}`;
        const bucket = totals.get(key) || { macro: seg.macro, micro: seg.micro, seconds: 0 };
        bucket.seconds += seg.seconds;
        totals.set(key, bucket);
      });
    });

    return {
      totalSeconds,
      segments: Array.from(totals.values())
        .map((t) => ({
          ...t,
          seconds: Math.round(t.seconds),
          pctOfTotal: totalSeconds > 0 ? Math.round((t.seconds / totalSeconds) * 100) : 0,
        }))
        .sort((a, b) => b.seconds - a.seconds),
    };
  }

  // ==========================================================
  // 10. Visit recording
  // ==========================================================

  async function recordYouTubeVisit(metadata) {
    if (!metadata || (!metadata.videoId && !metadata.channelId && !metadata.channelName)) return null;

    let video = null;
    if (metadata.videoId) {
      video = await saveVideo(metadata);
    }

    const info = { channelId: metadata.channelId, channelName: metadata.channelName };
    if (!info.channelId && !info.channelName) {
      return { video, channel: null, explicit: false, predictionScheduled: false };
    }

    const store = await getChannelStore();
    // Bind a name-only record to the real ID as soon as YouTube reports one,
    // so a channel classified by hand keeps applying afterwards.
    if (bindChannelIdentity(store, info)) await saveChannelStore(store);

    const channel = lookupChannelIn(store, info) || lookupBuiltInChannel(info);
    const explicit = !!(channel && channel.pinned && isResolvedClassification(channel.classification));

    // Explicit classifications are final — never predict over them.
    if (explicit) return { video, channel, explicit: true, predictionScheduled: false };

    const settled = !!(
      channel &&
      channel.source === CHANNEL_SOURCES.PREDICTED &&
      isResolvedClassification(channel.classification)
    );
    if (settled) return { video, channel, explicit: false, predictionScheduled: false };

    // Fire and forget: prediction is background work and must never block
    // the tracking path.
    predictChannelClassification(metadata).catch((err) =>
      console.error("[Stoic YouTube] Background prediction error:", err)
    );
    return { video, channel, explicit: false, predictionScheduled: true };
  }

  // ==========================================================
  // 11. Store priming & cross-context invalidation
  // ==========================================================

  async function primeYouTubeStores() {
    await Promise.all([getChannelStore(), getVideoDatabase()]);
    storesPrimed = true;
    return { channelStore: channelStoreSnapshot, videoDb: videoDbSnapshot };
  }

  async function ensureYouTubeStoresLoaded() {
    if (storesPrimed) return { channelStore: channelStoreSnapshot, videoDb: videoDbSnapshot };
    return primeYouTubeStores();
  }

  // A manual override written from the options page has to be authoritative
  // in the service worker and the popup the moment it lands. Mirroring the
  // change here (and dropping the classification cache) is what makes that
  // true without any explicit message plumbing.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (Object.prototype.hasOwnProperty.call(changes, YT_CHANNELS_KEY)) {
        channelStoreSnapshot = migrateChannelStore(changes[YT_CHANNELS_KEY].newValue);
        invalidateClassificationCache();
      }
      if (Object.prototype.hasOwnProperty.call(changes, YT_VIDEOS_KEY)) {
        videoDbSnapshot = changes[YT_VIDEOS_KEY].newValue || {};
        invalidateClassificationCache();
      }
      if (Object.prototype.hasOwnProperty.call(changes, AI_SETTINGS_KEY)) {
        inMemoryAISettings = { ...DEFAULT_AI_SETTINGS, ...(changes[AI_SETTINGS_KEY].newValue || {}) };
      }
    });
  }

  return {
    // keys & vocabulary
    YT_CHANNELS_KEY,
    YT_VIDEOS_KEY,
    AI_SETTINGS_KEY,
    CHANNEL_SOURCES,
    UNCLASSIFIED_MICRO,
    MAX_VIDEOS_RETAINED,
    MAX_ATTRIBUTION_KEYS_PER_DAY,
    BUILT_IN_CHANNEL_CLASSIFICATIONS,
    DEFAULT_AI_SETTINGS,
    DEFAULT_AI_CONFIDENCE_THRESHOLD,

    // helpers
    isYouTubeDomain,
    normalizeChannelName,
    canonicalChannelKey,
    normalizeClassification,
    isResolvedClassification,
    lookupBuiltInChannel,

    // channel store
    getChannelStore,
    getChannelStoreSync,
    saveChannelStore,
    migrateChannelStore,
    lookupChannelIn,
    lookupChannelSync,
    getChannel,
    listChannels,
    upsertChannel,
    setChannelClassification,
    unpinChannel,
    deleteChannel,
    clearChannelStore,

    // video store
    getVideoDatabase,
    getVideoDatabaseSync,
    saveVideoDatabase,
    getVideo,
    saveVideo,
    setVideoOverride,
    clearVideoDatabase,

    // prediction
    getAISettings,
    saveAISettings,
    predictFromText,
    HEURISTIC_RULES,
    BaseChannelPredictionProvider,
    HeuristicAIClassifierProvider,
    CustomAPIClassifierProvider,
    AIClassifierRegistry,
    defaultAIClassifierRegistry,
    predictChannelClassification,

    // resolution
    resolveYouTubeClassification,
    explainYouTubeClassification,
    YouTubeClassifierRule,

    // attribution
    attributionKeyForContext,
    creditYouTubeSeconds,
    attributionMapFor,
    resolveYouTubeSegments,
    youtubeCategoryTotals,

    // lifecycle
    recordYouTubeVisit,
    primeYouTubeStores,
    ensureYouTubeStoresLoaded,
  };
});
