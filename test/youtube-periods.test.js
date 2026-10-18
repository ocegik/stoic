const test = require("node:test");
const assert = require("node:assert/strict");
const {
  creditYouTubeSeconds,
  closeYouTubePeriods,
  labelYouTubePeriod,
  resolveYouTubeSegments,
} = require("../youtube-classifier.js");

test("finished hours default to Leisure, answered ones move, open hour stays open", () => {
  const entry = { usedSeconds: 3600 };
  creditYouTubeSeconds(entry, "p:00", 2400, "2026-10-19");
  creditYouTubeSeconds(entry, "p:01", 1200, "2026-10-19");
  const keys = entry.youtube.keys;

  const closed = closeYouTubePeriods(keys, "p:01");
  assert.deepEqual(closed, [{ hour: "00", seconds: 2400 }]);
  assert.deepEqual(keys, { "p:00:Leisure": 2400, "p:01": 1200 });

  assert.equal(labelYouTubePeriod(keys, "00", "Productivity"), true);
  assert.equal(labelYouTubePeriod(keys, "00", "Nonsense"), false);
  assert.deepEqual(keys, { "p:00:Productivity": 2400, "p:01": 1200 });

  const segs = resolveYouTubeSegments("youtube.com", entry, "2026-10-19", 3600, {});
  assert.deepEqual(
    segs.map((s) => [s.macro, s.seconds]),
    [["Productivity", 2400], ["Leisure", 1200]]
  );
});
