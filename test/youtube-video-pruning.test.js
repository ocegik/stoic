// Covers a real bug fixed in youtube-classifier.js: pruneVideoDatabase used
// to drop the least-recently-touched videos with no regard for whether
// today's watch-time attribution (`v:<videoId>` keys on a site entry) still
// pointed at them. Once pruned, classificationForKey() had no channel to
// resolve back to and silently fell back to the generic domain category —
// so a video watched early today could lose its category later the same
// day just because enough *other* videos were watched afterward.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getVideoDatabase,
  saveVideoDatabase,
  clearVideoDatabase,
  clearChannelStore,
  MAX_VIDEOS_RETAINED,
  setChannelClassification,
  recordYouTubeVisit,
  attributionKeyForContext,
  creditYouTubeSeconds,
  resolveYouTubeSegments,
  CHANNEL_SOURCES,
} = require("../youtube-classifier.js");

function isoAt(baseDate, offsetMinutes) {
  return new Date(baseDate.getTime() + offsetMinutes * 60000).toISOString();
}

test("pruning keeps a video touched today even when it falls outside the recency window", async () => {
  await clearVideoDatabase();

  const now = new Date();
  const todayEarly = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 1, 0);
  const yesterday = new Date(todayEarly.getTime() - 24 * 60 * 60000);

  const db = {};
  // 750 fillers, all touched today but later than the target below.
  for (let i = 0; i < MAX_VIDEOS_RETAINED; i++) {
    db[`filler-${i}`] = {
      videoId: `filler-${i}`,
      title: "filler",
      channelId: null,
      channelName: null,
      contentType: "video",
      override: null,
      overrideAt: null,
      updatedAt: isoAt(todayEarly, i + 1),
    };
  }
  // Touched today, but earlier than all 750 fillers above -> ranks 751st.
  db["target-today"] = {
    videoId: "target-today",
    title: "target",
    channelId: "UC_TARGET",
    channelName: "Target Channel",
    contentType: "video",
    override: null,
    overrideAt: null,
    updatedAt: todayEarly.toISOString(),
  };
  // Ranks last: not touched today and never overridden.
  db["stale-yesterday"] = {
    videoId: "stale-yesterday",
    title: "stale",
    channelId: null,
    channelName: null,
    contentType: "video",
    override: null,
    overrideAt: null,
    updatedAt: yesterday.toISOString(),
  };

  await saveVideoDatabase(db);
  const pruned = await getVideoDatabase();

  assert.ok(pruned["target-today"], "a video touched today must survive pruning even when it ranks below the cap");
  assert.equal(pruned["stale-yesterday"], undefined, "a stale, unreferenced video from a prior day should still be pruned");
});

test("end to end: a video watched early today keeps resolving to its channel's category after many later videos push it past the cap", async () => {
  await clearChannelStore();
  await clearVideoDatabase();

  await setChannelClassification(
    { channelId: "UC_EARLY_BIRD", channelName: "Early Bird Coding" },
    { macro: "Productivity", micro: "Coding" }
  );

  const today = new Date();
  const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const earlyMeta = {
    url: "https://www.youtube.com/watch?v=early_video",
    domain: "youtube.com",
    videoId: "early_video",
    title: "Building a compiler from scratch",
    channelId: "UC_EARLY_BIRD",
    channelName: "Early Bird Coding",
    contentType: "video",
    timestamp: Date.now(),
  };

  await recordYouTubeVisit(earlyMeta);

  const entry = { mode: "unconstrained", usedSeconds: 0, lastReset: dayKey, history: [], createdAt: dayKey };
  const key = attributionKeyForContext(earlyMeta);
  creditYouTubeSeconds(entry, key, 300, dayKey);

  // Flood the video DB with enough later-today videos to push early_video
  // past MAX_VIDEOS_RETAINED.
  const db = await getVideoDatabase();
  for (let i = 0; i < MAX_VIDEOS_RETAINED + 50; i++) {
    db[`flood-${i}`] = {
      videoId: `flood-${i}`,
      title: "flood",
      channelId: null,
      channelName: null,
      contentType: "video",
      override: null,
      overrideAt: null,
      updatedAt: new Date(today.getTime() + (i + 1) * 1000).toISOString(),
    };
  }
  await saveVideoDatabase(db);

  const segments = resolveYouTubeSegments("youtube.com", entry, dayKey, 300, {});
  assert.ok(segments, "attribution must still resolve after pruning pressure");
  const codingBucket = segments.find((s) => s.micro === "Coding");
  assert.ok(codingBucket, "early_video must still resolve to its channel's Coding classification, not the generic domain fallback");
  assert.equal(codingBucket.seconds, 300);
});
