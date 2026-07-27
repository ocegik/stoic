const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HeuristicAIClassifierProvider,
  CustomAPIClassifierProvider,
  predictChannelClassification,
  setChannelClassification,
  getChannel,
  saveVideo,
  saveAISettings,
  CHANNEL_SOURCES,
} = require("../youtube-classifier.js");

test("HeuristicAIClassifierProvider: classifies channels accurately based on channel and video title keywords", async () => {
  const provider = new HeuristicAIClassifierProvider();

  // Educational / Study
  const resEdu = await provider.classifyChannel({
    channelName: "3Blue1Brown",
    videoTitle: "Linear Algebra Chapter 1",
  });
  assert.equal(resEdu.micro, "Study");
  assert.equal(resEdu.macro, "Productivity");
  assert.ok(resEdu.confidence >= 0.85);

  // Coding / Tech
  const resCoding = await provider.classifyChannel({
    channelName: "Fireship",
    videoTitle: "React 19 in 100 Seconds",
  });
  assert.equal(resCoding.micro, "Coding");
  assert.equal(resCoding.macro, "Productivity");

  // Gaming
  const resGaming = await provider.classifyChannel({
    channelName: "IGN",
    videoTitle: "Zelda Breath of the Wild Walkthrough Gameplay",
  });
  assert.equal(resGaming.micro, "Gaming");
  assert.equal(resGaming.macro, "Leisure");
});

test("HeuristicAIClassifierProvider: utilizes multiple recent video titles for rich channel profile", async () => {
  const provider = new HeuristicAIClassifierProvider();

  // Channel name is vague ("Tech Life"), but recent video titles indicate coding
  const resProfile = await provider.classifyChannel({
    channelName: "Tech Life",
    videoTitle: "Vlog 42",
    videoTitles: ["TypeScript Complete Course", "Building a Compiler in Rust", "LeetCode Hard Solutions"],
  });
  assert.equal(resProfile.micro, "Coding");
  assert.equal(resProfile.macro, "Productivity");
  assert.ok(resProfile.reason.includes("analyzed"));
});

test("CustomAPIClassifierProvider: falls back gracefully to Heuristic when API key/endpoint missing or failing", async () => {
  const customProvider = new CustomAPIClassifierProvider({ apiKey: "", endpoint: "" });
  const resFallback = await customProvider.classifyChannel({
    channelName: "FreeCodeCamp",
    videoTitle: "Learn Python Full Course",
  });

  assert.equal(resFallback.micro, "Coding");
});

test("predictChannelClassification: classifies unknown channel, caches permanently, and respects manual override protection", async () => {
  const meta = {
    channelId: "UC_TEST_MATH",
    channelName: "Math Visualized",
    title: "Calculus Limits Explained",
  };

  // 1. Initial AI classification
  const classified = await predictChannelClassification(meta, { forceReclassify: true });
  assert.equal(classified.classification.micro, "Study");
  assert.equal(classified.source, CHANNEL_SOURCES.PREDICTED);
  assert.ok(classified.reason.length > 0);

  // 2. Subsequent call reuses stored DB classification without re-running AI
  const cachedCall = await predictChannelClassification(meta);
  assert.equal(cachedCall.classification.micro, "Study");
  assert.equal(cachedCall.source, CHANNEL_SOURCES.PREDICTED);

  // 3. Manual override protection
  await setChannelClassification(
    { channelId: "UC_TEST_MATH", channelName: "Math Visualized" },
    { macro: "Leisure", micro: "Streaming" },
    { reason: "User specified streaming" }
  );

  const pinned = await getChannel("UC_TEST_MATH");
  assert.equal(pinned.pinned, true, "A manual classification must pin the channel");

  // Attempting automatic classification must NEVER overwrite manual classification!
  const manualAttempt = await predictChannelClassification(meta);
  assert.equal(manualAttempt.source, CHANNEL_SOURCES.MANUAL);
  assert.equal(manualAttempt.classification.micro, "Streaming");

  // Force reclassify overrides manual classification only when explicitly forced
  const forcedAttempt = await predictChannelClassification(meta, { forceReclassify: true });
  assert.equal(forcedAttempt.classification.micro, "Study");
});

test("predictChannelClassification: low confidence fallback to Unclassified", async () => {
  class LowConfidenceProvider {
    async classifyChannel() {
      return { macro: "General", micro: "UncertainTopic", confidence: 0.4, reason: "Ambiguous data" };
    }
  }

  const metaLow = {
    channelId: "UC_AMBIGUOUS_123",
    channelName: "Random Channel X",
    title: "Video 1",
  };

  const resLow = await predictChannelClassification(metaLow, {
    provider: new LowConfidenceProvider(),
    confidenceThreshold: 0.70,
    forceReclassify: true,
  });

  assert.equal(resLow.classification.micro, "Unclassified");
  assert.equal(resLow.source, CHANNEL_SOURCES.UNCLASSIFIED);
});

test("predictChannelClassification: debouncing concurrent calls for the same channel", async () => {
  const meta = {
    channelId: "UC_DEBOUNCE_TEST",
    channelName: "Concurrent Test Channel",
    title: "Python Tutorial",
  };

  // Fire 3 concurrent classification calls simultaneously
  const p1 = predictChannelClassification(meta, { forceReclassify: true });
  const p2 = predictChannelClassification(meta, { forceReclassify: true });
  const p3 = predictChannelClassification(meta, { forceReclassify: true });

  // All 3 promises should resolve to the exact same result object reference
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1, r2);
  assert.equal(r2, r3);
  assert.equal(r1.classification.micro, "Coding");
});

test("predictChannelClassification: retries transient provider errors", async () => {
  let attemptCount = 0;
  class FlakyProvider {
    async classifyChannel() {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error("Network timeout");
      }
      return { macro: "Productivity", micro: "Study", confidence: 0.9, reason: "Retry success" };
    }
  }

  const metaRetry = {
    channelId: "UC_FLAKY_CHANNEL",
    channelName: "Flaky Channel",
    title: "Math Fundamentals",
  };

  const resRetry = await predictChannelClassification(metaRetry, {
    provider: new FlakyProvider(),
    maxRetries: 2,
    forceReclassify: true,
  });

  assert.equal(attemptCount, 2);
  assert.equal(resRetry.classification.micro, "Study");
});

test("predictChannelClassification: respects autoClassify toggle setting", async () => {
  await saveAISettings({ autoClassify: false });

  const metaDisabled = {
    channelId: "UC_DISABLED_AUTOCLASSIFY",
    channelName: "New Channel",
    title: "JavaScript Tutorial",
  };

  // Without forceReclassify, autoClassify=false prevents background classification
  const resDisabled = await predictChannelClassification(metaDisabled);
  assert.equal(resDisabled, null);

  // Explicit forceReclassify bypasses autoClassify toggle
  const resForced = await predictChannelClassification(metaDisabled, { forceReclassify: true });
  assert.equal(resForced.classification.micro, "Coding");

  // Restore default settings
  await saveAISettings({ autoClassify: true });
});

test("predictChannelClassification: incorporates historical video titles from video database", async () => {
  // Pre-populate video database with recent videos for this channel
  await saveVideo({ videoId: "v1", channelId: "UC_HISTORICAL", channelName: "Dev Channel", title: "React Hooks In Depth" });
  await saveVideo({ videoId: "v2", channelId: "UC_HISTORICAL", channelName: "Dev Channel", title: "Node.js Performance Tuning" });

  let capturedVideoTitles = [];
  class TitleSpyProvider {
    async classifyChannel(info) {
      capturedVideoTitles = info.videoTitles || [];
      return { macro: "Productivity", micro: "Coding", confidence: 0.95, reason: "Spy" };
    }
  }

  await predictChannelClassification(
    { channelId: "UC_HISTORICAL", channelName: "Dev Channel", title: "Docker Containerization" },
    { provider: new TitleSpyProvider(), forceReclassify: true }
  );

  assert.ok(capturedVideoTitles.includes("React Hooks In Depth"));
  assert.ok(capturedVideoTitles.includes("Node.js Performance Tuning"));
  assert.ok(capturedVideoTitles.includes("Docker Containerization"));
});
