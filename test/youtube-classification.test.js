const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ClassificationContext,
  classifyContext,
  getBrowsingStats,
  getCategoryBreakdown,
  calculateFocusScore,
} = require("../common.js");

const {
  YouTubeClassifierRule,
  resolveYouTubeClassification,
  explainYouTubeClassification,
  migrateChannelStore,
  lookupChannelIn,
  attributionKeyForContext,
  creditYouTubeSeconds,
  resolveYouTubeSegments,
  youtubeCategoryTotals,
  setChannelClassification,
  clearChannelStore,
  clearVideoDatabase,
  saveVideo,
  setVideoOverride,
  predictChannelClassification,
  getChannel,
  CHANNEL_SOURCES,
} = require("../youtube-classifier.js");

// A store built the way migrateChannelStore() produces one, so the tests
// exercise the same shape the extension persists.
function storeOf(records) {
  return migrateChannelStore(
    records.reduce((acc, r) => {
      acc[r.channelId] = r;
      return acc;
    }, {})
  );
}

const CODING_CHANNEL = {
  channelId: "UC_CODING_TRAIN",
  channelName: "The Coding Train",
  classification: { macro: "Productivity", micro: "Coding" },
  confidence: 0.95,
  source: "ai",
};

test("YouTubeExtractorAdapter feeds the resolver: video ID, channel and content type", () => {
  const ctx = ClassificationContext.create("https://www.youtube.com/watch?v=9bZkp7q19f0", {
    title: "Gangnam Style",
    channelId: "UC3IZKrv7hyp78tJVZ615XBQ",
    channelName: "officialpsy",
  });

  const extracted = require("../common.js").defaultExtractorRegistry.extract(ctx);
  assert.equal(extracted.domain, "youtube.com");
  assert.equal(extracted.videoId, "9bZkp7q19f0");
  assert.equal(extracted.channelId, "UC3IZKrv7hyp78tJVZ615XBQ");
  assert.equal(extracted.contentType, "video");
});

test("precedence: explicit channel classification beats everything downstream", () => {
  const store = storeOf([
    {
      channelId: "UC_PINNED",
      channelName: "Pinned Channel",
      classification: { macro: "Productivity", micro: "Study" },
      source: "manual",
    },
  ]);

  // Even with a blanket user category on youtube.com itself, the explicit
  // channel classification is the final answer.
  const sites = { "youtube.com": { microCategory: "Streaming", macroCategory: "Leisure" } };
  const { result, trace } = resolveYouTubeClassification(
    { domain: "youtube.com", channelId: "UC_PINNED", title: "Some random vlog" },
    { channelStore: store, videoDb: {}, sites }
  );

  assert.equal(result.macro, "Productivity");
  assert.equal(result.micro, "Study");
  assert.equal(result.source, "manual_channel");
  assert.equal(result.confidence, 1.0);
  assert.equal(trace.find((t) => t.step === "explicit_channel").status, "hit");
  // Nothing after the explicit step should have been consulted.
  assert.equal(trace.find((t) => t.step === "site_override"), undefined);
});

test("precedence: a per-video override outranks its channel's explicit classification", () => {
  const store = storeOf([
    {
      channelId: "UC_PINNED",
      channelName: "Pinned Channel",
      classification: { macro: "Productivity", micro: "Study" },
      source: "manual",
    },
  ]);
  const videoDb = {
    vid1: {
      videoId: "vid1",
      channelId: "UC_PINNED",
      title: "Off-topic stream",
      override: { macro: "Leisure", micro: "Entertainment" },
    },
  };

  const { result } = resolveYouTubeClassification(
    { domain: "youtube.com", videoId: "vid1", channelId: "UC_PINNED" },
    { channelStore: store, videoDb }
  );

  assert.equal(result.macro, "Leisure");
  assert.equal(result.micro, "Entertainment");
  assert.equal(result.source, "manual_video");
});

test("precedence: site-level override sits above prediction but below explicit channels", () => {
  const store = storeOf([CODING_CHANNEL]);
  const sites = { "youtube.com": { microCategory: "News", macroCategory: "General" } };

  const { result } = resolveYouTubeClassification(
    { domain: "youtube.com", channelId: "UC_CODING_TRAIN" },
    { channelStore: store, videoDb: {}, sites }
  );

  assert.equal(result.source, "user_override");
  assert.equal(result.micro, "News");

  // Without the site override, the stored prediction applies.
  const { result: predicted } = resolveYouTubeClassification(
    { domain: "youtube.com", channelId: "UC_CODING_TRAIN" },
    { channelStore: store, videoDb: {}, sites: {} }
  );
  assert.equal(predicted.source, "predicted_channel");
  assert.equal(predicted.micro, "Coding");
});

test("prediction: an unclassified channel still gets classified from the video's own title", () => {
  const store = storeOf([
    {
      channelId: "UC_MIXED",
      channelName: "Mixed Bag",
      classification: { macro: "General", micro: "Unclassified" },
      source: "ai_unclassified",
    },
  ]);

  const { result } = resolveYouTubeClassification(
    { domain: "youtube.com", videoId: "abc", channelId: "UC_MIXED", title: "Rust Ownership Explained for Beginners" },
    { channelStore: store, videoDb: {} }
  );

  assert.equal(result.source, "predicted_video");
  assert.equal(result.micro, "Coding");
  assert.ok(result.confidence < 0.92, "A single title is weaker evidence than a channel profile");
});

test("built-in channel table classifies known channels with no prediction and no stored record", () => {
  const { result } = resolveYouTubeClassification(
    { domain: "youtube.com", channelName: "freeCodeCamp.org", title: "Anything at all" },
    { channelStore: migrateChannelStore({}), videoDb: {} }
  );

  assert.equal(result.source, "builtin_channel");
  assert.equal(result.micro, "Coding");
});

test("fallthrough: a YouTube page with no video or channel signal defers to the domain rule", () => {
  const { result, trace } = resolveYouTubeClassification(
    { domain: "youtube.com" },
    { channelStore: migrateChannelStore({}), videoDb: {} }
  );

  assert.equal(result, null);
  assert.equal(trace[trace.length - 1].step, "domain_rule");

  const explained = explainYouTubeClassification({ domain: "youtube.com" }, {});
  assert.equal(explained.result.macro, "Leisure");
  assert.equal(explained.result.micro, "Streaming");
});

test("pipeline: the YouTube rule runs ahead of the generic user-override rule", () => {
  const rule = new YouTubeClassifierRule({
    channelStore: storeOf([
      {
        channelId: "UC_PINNED",
        channelName: "Pinned Channel",
        classification: { macro: "Productivity", micro: "Study" },
        source: "manual",
      },
    ]),
    videoDb: {},
  });

  const ordered = require("../common.js").defaultClassificationPipeline.orderedRules.map((r) => r.name);
  assert.equal(ordered[0], "youtube", "youtube must be the first rule in the default pipeline");
  assert.ok(ordered.indexOf("user_override") > 0);

  const res = rule.classify(
    new ClassificationContext({ domain: "youtube.com", channelId: "UC_PINNED" }),
    { "youtube.com": { microCategory: "Streaming" } }
  );
  assert.equal(res.micro, "Study");

  assert.equal(rule.classify(new ClassificationContext({ domain: "github.com" })), null);
});

test("channel store: legacy duplicate keys collapse and name records rebind to real IDs", async () => {
  // Older builds stored the same record under both its ID and its name.
  const legacy = {
    UC_ABC: { channelId: "UC_ABC", channelName: "Dup Channel", classification: { macro: "Productivity", micro: "Coding" }, source: "ai" },
    "Dup Channel": { channelId: "UC_ABC", channelName: "Dup Channel", classification: { macro: "Productivity", micro: "Coding" }, source: "ai" },
  };
  const store = migrateChannelStore(legacy);
  assert.equal(Object.keys(store.channels).length, 1);
  assert.equal(store.channels.UC_ABC.source, CHANNEL_SOURCES.PREDICTED);
  assert.equal(lookupChannelIn(store, { channelName: "dup channel" }).channelId, "UC_ABC");

  // A channel classified by name before its ID is known must keep applying
  // once the content script reports the real ID.
  await clearChannelStore();
  await setChannelClassification({ channelName: "Handle Only" }, { macro: "Productivity", micro: "Study" });
  const byName = await getChannel("Handle Only");
  assert.equal(byName.channelId, "name:handle only");

  const rebound = await predictChannelClassification(
    { channelId: "UC_REAL_ID", channelName: "Handle Only", title: "Gameplay walkthrough" },
    {}
  );
  assert.equal(rebound.channelId, "UC_REAL_ID", "the record must rebind to the real channel ID");
  assert.equal(rebound.source, CHANNEL_SOURCES.MANUAL, "prediction must not overwrite the manual classification");
  assert.equal(rebound.classification.micro, "Study");
});

test("attribution: watch time is credited per video and resolved at read time", async () => {
  await clearChannelStore();
  await clearVideoDatabase();

  await saveVideo({ videoId: "lecture1", channelId: "UC_PROF", channelName: "Prof Channel", title: "Untitled" });
  await saveVideo({ videoId: "meme1", channelId: "UC_MEME", channelName: "Meme Channel", title: "Untitled" });

  const entry = { mode: "unconstrained", usedSeconds: 0, lastReset: "2026-07-28", history: [] };
  const day = "2026-07-28";

  assert.equal(attributionKeyForContext({ videoId: "lecture1", channelId: "UC_PROF" }), "v:lecture1");
  assert.equal(attributionKeyForContext({ channelId: "UC_PROF" }), "c:UC_PROF");
  assert.equal(attributionKeyForContext({}), "browse");

  creditYouTubeSeconds(entry, "v:lecture1", 1800, day);
  creditYouTubeSeconds(entry, "v:meme1", 600, day);
  creditYouTubeSeconds(entry, "browse", 200, day);
  entry.usedSeconds = 2600;

  // Nothing is classified yet: everything resolves to the domain default.
  let segments = resolveYouTubeSegments("youtube.com", entry, day, 2600, {});
  assert.equal(segments.length, 1);
  assert.equal(segments[0].micro, "Streaming");
  assert.equal(segments[0].seconds, 2600);

  // Classifying the channel retroactively re-attributes today's time.
  await setChannelClassification({ channelId: "UC_PROF", channelName: "Prof Channel" }, { macro: "Productivity", micro: "Study" });

  segments = resolveYouTubeSegments("youtube.com", entry, day, 2600, {});
  const study = segments.find((s) => s.micro === "Study");
  const leisure = segments.find((s) => s.micro === "Streaming");
  assert.equal(study.seconds, 1800);
  assert.equal(leisure.seconds, 800, "the unclassified video and browse time stay on the domain default");

  // A per-video override is honoured over its channel.
  await setVideoOverride("lecture1", { macro: "Leisure", micro: "Entertainment" });
  segments = resolveYouTubeSegments("youtube.com", entry, day, 2600, {});
  assert.equal(segments.find((s) => s.micro === "Entertainment").seconds, 1800);
  assert.equal(segments.find((s) => s.micro === "Study"), undefined);
});

test("attribution flows into focus score, category breakdown and browsing stats", async () => {
  await clearChannelStore();
  await clearVideoDatabase();
  const day = "2026-07-28";

  await saveVideo({ videoId: "l1", channelId: "UC_PROF", channelName: "Prof Channel", title: "Untitled" });
  await setChannelClassification({ channelId: "UC_PROF", channelName: "Prof Channel" }, { macro: "Productivity", micro: "Study" });

  const entry = { mode: "unconstrained", usedSeconds: 3600, lastReset: day, history: [] };
  creditYouTubeSeconds(entry, "v:l1", 3600, day);
  const sites = { "youtube.com": entry };

  // Before this work every one of these treated the hour as Leisure.
  const breakdown = getCategoryBreakdown(sites, day);
  assert.equal(breakdown.macroBreakdown[0].macro, "Productivity");
  assert.equal(breakdown.macroBreakdown[0].seconds, 3600);

  assert.equal(calculateFocusScore(sites, day), 100, "an hour of classified-productive YouTube must score as productive");

  const browsing = getBrowsingStats(sites, day);
  assert.equal(browsing.topWebsites[0].macroCategory, "Productivity");
  assert.equal(browsing.topWebsites[0].category, "Study");

  const totals = youtubeCategoryTotals(sites, day);
  assert.equal(totals.totalSeconds, 3600);
  assert.equal(totals.segments[0].micro, "Study");
  assert.equal(totals.segments[0].pctOfTotal, 100);

  // An unclassified YouTube entry still behaves exactly as it always did.
  const plain = { mode: "unconstrained", usedSeconds: 3600, lastReset: day, history: [] };
  assert.ok(calculateFocusScore({ "youtube.com": plain }, day) <= 20);
});

test("classifyContext end to end: a classified channel changes the answer for a watch URL", async () => {
  await clearChannelStore();
  await clearVideoDatabase();

  const url = "https://www.youtube.com/watch?v=endtoend";
  const before = classifyContext({ url, channelId: "UC_E2E", channelName: "E2E Channel" }, {});
  assert.equal(before.macro, "Leisure");

  await setChannelClassification({ channelId: "UC_E2E", channelName: "E2E Channel" }, { macro: "Productivity", micro: "Coding" });

  const after = classifyContext({ url, channelId: "UC_E2E", channelName: "E2E Channel" }, {});
  assert.equal(after.macro, "Productivity");
  assert.equal(after.micro, "Coding");
  assert.equal(after.source, "manual_channel");
});
