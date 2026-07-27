const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ClassificationContext,
  ClassificationResult,
  YouTubeExtractorAdapter,
  ChannelClassifierRule,
  DomainRuleClassifierRule,
  ClassificationPipeline,
  classifyContext,
} = require("../common.js");

test("YouTubeExtractorAdapter: extracts video ID, title, channel, and content type from context input", () => {
  const adapter = new YouTubeExtractorAdapter();

  const ctx = adapter.extract(
    ClassificationContext.create("https://www.youtube.com/watch?v=9bZkp7q19f0", {
      title: "Gangnam Style",
      channelId: "UC3IZKrv7hyp78tJVZ615XBQ",
      channelName: "officialpsy",
    })
  );

  assert.equal(ctx.domain, "youtube.com");
  assert.equal(ctx.videoId, "9bZkp7q19f0");
  assert.equal(ctx.title, "Gangnam Style");
  assert.equal(ctx.channelId, "UC3IZKrv7hyp78tJVZ615XBQ");
  assert.equal(ctx.channelName, "officialpsy");
  assert.equal(ctx.contentType, "video");
});

test("ChannelClassifierRule: returns channel classification when channel exists in Channel Database", () => {
  const rule = new ChannelClassifierRule();

  const mockChannelDb = {
    UC_VERITASIUM: {
      channelId: "UC_VERITASIUM",
      channelName: "Veritasium",
      classification: { macro: "Productivity", micro: "Study" },
      confidence: 0.95,
      updatedAt: "2026-07-27T10:00:00Z",
    },
  };

  // 1. Channel DB Hit by Channel ID
  const hitCtx = new ClassificationContext({
    domain: "youtube.com",
    url: "https://www.youtube.com/watch?v=demo123",
    channelId: "UC_VERITASIUM",
    channelName: "Veritasium",
    metadata: { channelDb: mockChannelDb },
  });

  const resHit = rule.classify(hitCtx);
  assert.notEqual(resHit, null);
  assert.equal(resHit.macro, "Productivity");
  assert.equal(resHit.micro, "Study");
  assert.equal(resHit.confidence, 0.95);
  assert.equal(resHit.source, "channel_database");

  // 2. Channel DB Miss (Channel not present)
  const missCtx = new ClassificationContext({
    domain: "youtube.com",
    url: "https://www.youtube.com/watch?v=unknown",
    channelId: "UC_UNKNOWN",
    channelName: "Unknown Channel",
    metadata: { channelDb: mockChannelDb },
  });

  const resMiss = rule.classify(missCtx);
  assert.equal(resMiss, null);
});

test("Full YouTube Pipeline: Channel DB hit vs Domain Fallback", () => {
  const pipeline = new ClassificationPipeline();
  pipeline.addRule(new ChannelClassifierRule());
  pipeline.addRule(new DomainRuleClassifierRule());

  const channelDb = {
    "UC_CODING_TRAIN": {
      channelId: "UC_CODING_TRAIN",
      channelName: "The Coding Train",
      classification: { macro: "Productivity", micro: "Coding" },
      confidence: 1.0,
    },
  };

  // Case A: Known Channel -> Classified by Channel DB
  const resultKnown = pipeline.classify(
    new ClassificationContext({
      domain: "youtube.com",
      url: "https://www.youtube.com/watch?v=coding101",
      channelId: "UC_CODING_TRAIN",
      metadata: { channelDb },
    })
  );

  assert.equal(resultKnown.source, "channel_database");
  assert.equal(resultKnown.macro, "Productivity");
  assert.equal(resultKnown.micro, "Coding");
  assert.equal(resultKnown.confidence, 1.0);

  // Case B: Unknown Channel -> Falls back to Domain Rule (Leisure / Streaming)
  const resultUnknown = pipeline.classify(
    new ClassificationContext({
      domain: "youtube.com",
      url: "https://www.youtube.com/watch?v=randomVideo",
      channelId: "UC_RANDOM",
      metadata: { channelDb },
    })
  );

  assert.equal(resultUnknown.source, "domain_rule");
  assert.equal(resultUnknown.macro, "Leisure");
  assert.equal(resultUnknown.micro, "Streaming");
  assert.equal(resultUnknown.confidence, 0.8);
});
