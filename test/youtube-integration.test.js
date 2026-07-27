// End-to-end exercise of the YouTube subsystem along the path the
// extension actually takes: content-script metadata -> visit recording ->
// per-tick watch-time attribution -> analytics -> manual override ->
// downstream propagation -> day rollover.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateFocusScore,
  getCategoryBreakdown,
  getBrowsingStats,
  usageSecondsForDate,
} = require("../common.js");
const { ensureReset } = require("../background-logic.js");
const {
  recordYouTubeVisit,
  attributionKeyForContext,
  creditYouTubeSeconds,
  setChannelClassification,
  getChannel,
  clearChannelStore,
  clearVideoDatabase,
  saveAISettings,
  youtubeCategoryTotals,
  CHANNEL_SOURCES,
} = require("../youtube-classifier.js");

const DAY = "2026-07-28";

// What youtube-content.js broadcasts for a watch page.
function metadataFor(videoId, channelId, channelName, title) {
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    domain: "youtube.com",
    videoId,
    title,
    channelId,
    channelName,
    contentType: "video",
    timestamp: Date.now(),
  };
}

function freshEntry() {
  return { mode: "unconstrained", usedSeconds: 0, lastReset: DAY, history: [], createdAt: DAY };
}

// The credit path background.js runs on every tick.
function tickCredit(entry, metadata, seconds) {
  entry.usedSeconds += seconds;
  creditYouTubeSeconds(entry, attributionKeyForContext(metadata), seconds, DAY);
}

test("end to end: prediction classifies a channel and its watch time is scored as productive", async () => {
  await clearChannelStore();
  await clearVideoDatabase();
  await saveAISettings({ autoClassify: true, confidenceThreshold: 0.7 });

  const meta = metadataFor("vid_rust", "UC_RUSTY", "Rust Academy", "Rust Ownership and Borrowing Explained");

  const visit = await recordYouTubeVisit(meta);
  assert.equal(visit.video.videoId, "vid_rust");
  assert.equal(visit.predictionScheduled, true, "an unknown channel must schedule a prediction");

  // recordYouTubeVisit fires prediction without awaiting it.
  await new Promise((r) => setTimeout(r, 40));

  const predicted = await getChannel("UC_RUSTY");
  assert.equal(predicted.source, CHANNEL_SOURCES.PREDICTED);
  assert.equal(predicted.classification.micro, "Coding");
  assert.equal(predicted.pinned, false, "a prediction must not pin the channel");

  const entry = freshEntry();
  tickCredit(entry, meta, 1800);
  const sites = { "youtube.com": entry };

  assert.equal(usageSecondsForDate(entry, DAY, DAY), 1800);
  assert.equal(calculateFocusScore(sites, DAY), 100);
  assert.equal(getCategoryBreakdown(sites, DAY).macroBreakdown[0].macro, "Productivity");

  // A second visit to a settled channel does not re-run prediction.
  const revisit = await recordYouTubeVisit(metadataFor("vid_rust2", "UC_RUSTY", "Rust Academy", "Traits Deep Dive"));
  assert.equal(revisit.predictionScheduled, false);
});

test("end to end: a manual override immediately overrules the prediction everywhere", async () => {
  await clearChannelStore();
  await clearVideoDatabase();

  const meta = metadataFor("vid_x", "UC_MIXED", "Mixed Channel", "Python Tutorial For Beginners");
  await recordYouTubeVisit(meta);
  await new Promise((r) => setTimeout(r, 40));

  const entry = freshEntry();
  tickCredit(entry, meta, 3600);
  const sites = { "youtube.com": entry };

  assert.equal(calculateFocusScore(sites, DAY), 100, "predicted as Coding -> productive");

  // The user disagrees: this channel is leisure, permanently.
  await setChannelClassification(
    { channelId: "UC_MIXED", channelName: "Mixed Channel" },
    { macro: "Leisure", micro: "Entertainment" }
  );

  const pinned = await getChannel("UC_MIXED");
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.source, CHANNEL_SOURCES.MANUAL);

  // Same stored seconds, re-resolved: the already-tracked hour moves too.
  assert.ok(calculateFocusScore(sites, DAY) <= 20, "the manual category must apply retroactively");
  assert.equal(getCategoryBreakdown(sites, DAY).macroBreakdown[0].macro, "Leisure");
  assert.equal(getBrowsingStats(sites, DAY).topWebsites[0].category, "Entertainment");
  assert.equal(youtubeCategoryTotals(sites, DAY).segments[0].micro, "Entertainment");

  // And prediction must never take it back.
  const after = await recordYouTubeVisit(meta);
  assert.equal(after.predictionScheduled, false);
  assert.equal(after.explicit, true);
});

test("end to end: a mixed day splits across categories in one site entry", async () => {
  await clearChannelStore();
  await clearVideoDatabase();

  const study = metadataFor("v_study", "UC_UNI", "Uni Lectures", "Linear Algebra Lecture 3");
  const game = metadataFor("v_game", "UC_PLAY", "Play Time", "Minecraft Speedrun Gameplay");
  await recordYouTubeVisit(study);
  await recordYouTubeVisit(game);
  await new Promise((r) => setTimeout(r, 40));

  const entry = freshEntry();
  tickCredit(entry, study, 2400); // 40 min of lectures
  tickCredit(entry, game, 1200); // 20 min of gaming
  tickCredit(entry, { domain: "youtube.com" }, 600); // 10 min browsing the home page
  const sites = { "youtube.com": entry };

  const breakdown = getCategoryBreakdown(sites, DAY);
  const byMacro = Object.fromEntries(breakdown.macroBreakdown.map((m) => [m.macro, m.seconds]));
  assert.equal(byMacro.Productivity, 2400);
  assert.equal(byMacro.Leisure, 1800, "gaming plus un-attributed home-page browsing");
  assert.equal(breakdown.totalSeconds, 4200);

  // Focus score lands between all-productive and all-leisure.
  const score = calculateFocusScore(sites, DAY);
  assert.ok(score > 20 && score < 100, `expected a mixed score, got ${score}`);

  const top = getBrowsingStats(sites, DAY).topWebsites[0];
  assert.equal(top.segmented, true);
  assert.equal(top.macroCategory, "Productivity", "the headline category is the dominant one");
});

test("day rollover archives the attribution alongside the day's total", async () => {
  await clearChannelStore();
  await clearVideoDatabase();

  const meta = metadataFor("v_arch", "UC_ARCH", "Archive Channel", "Docker Tutorial");
  await recordYouTubeVisit(meta);
  await new Promise((r) => setTimeout(r, 40));

  const entry = freshEntry();
  tickCredit(entry, meta, 900);

  const rolled = ensureReset(entry, "2026-07-29");
  assert.equal(rolled, true);
  assert.equal(entry.usedSeconds, 0);
  assert.equal(entry.youtube, null, "the live attribution map resets with the counter");

  const archived = entry.history.find((h) => h.date === DAY);
  assert.equal(archived.seconds, 900);
  assert.deepEqual(archived.youtube, { "v:v_arch": 900 });

  // The archived day still breaks down by category.
  const sites = { "youtube.com": entry };
  assert.equal(getCategoryBreakdown(sites, DAY).macroBreakdown[0].macro, "Productivity");
});
