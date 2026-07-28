// Exercises the custom_api prediction provider path, which was wired up
// (settings -> CustomAPIClassifierProvider -> predictChannelClassification)
// but never had a bundled remote provider or a test covering it.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CustomAPIClassifierProvider,
  HeuristicAIClassifierProvider,
  predictChannelClassification,
  saveAISettings,
  getChannel,
  clearChannelStore,
  clearVideoDatabase,
} = require("../youtube-classifier.js");

function withFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return fn().finally(() => {
    global.fetch = original;
  });
}

test("CustomAPIClassifierProvider falls back to the local heuristic when unconfigured", async () => {
  const provider = new CustomAPIClassifierProvider({ apiKey: "", endpoint: "" });
  const result = await provider.classifyChannel({ channelName: "Rust Academy", videoTitle: "Rust ownership tutorial" });
  const heuristic = await new HeuristicAIClassifierProvider().classifyChannel({
    channelName: "Rust Academy",
    videoTitle: "Rust ownership tutorial",
  });
  assert.deepEqual(result, heuristic);
});

test("CustomAPIClassifierProvider posts to the endpoint and returns its classification", async () => {
  let capturedUrl = null;
  let capturedBody = null;
  const provider = new CustomAPIClassifierProvider({ apiKey: "secret-key", endpoint: "https://example.test/classify" });

  await withFetch(async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    assert.equal(opts.headers.Authorization, "Bearer secret-key");
    return { json: async () => ({ macro: "Productivity", micro: "Coding", confidence: 0.93, reason: "Remote says so" }) };
  }, async () => {
    const result = await provider.classifyChannel({
      channelId: "UC_REMOTE",
      channelName: "Remote Channel",
      videoTitles: ["Building a compiler", "Intro to parsers"],
    });
    assert.deepEqual(result, {
      macro: "Productivity",
      micro: "Coding",
      confidence: 0.93,
      reason: "Remote says so",
    });
  });

  assert.equal(capturedUrl, "https://example.test/classify");
  assert.match(capturedBody.prompt, /Remote Channel/);
  assert.match(capturedBody.prompt, /Building a compiler; Intro to parsers/);
});

test("CustomAPIClassifierProvider falls back to the heuristic when the remote call fails", async () => {
  const provider = new CustomAPIClassifierProvider({ apiKey: "secret-key", endpoint: "https://example.test/classify" });

  await withFetch(async () => {
    throw new Error("network down");
  }, async () => {
    const result = await provider.classifyChannel({ channelName: "News Daily", videoTitle: "Breaking news bulletin" });
    assert.equal(result.micro, "News");
  });
});

test("CustomAPIClassifierProvider falls back to the heuristic on a malformed remote response", async () => {
  const provider = new CustomAPIClassifierProvider({ apiKey: "secret-key", endpoint: "https://example.test/classify" });

  await withFetch(async () => ({ json: async () => ({ unexpected: true }) }), async () => {
    const result = await provider.classifyChannel({ channelName: "Gaming Hub", videoTitle: "Minecraft speedrun walkthrough" });
    assert.equal(result.micro, "Gaming");
  });
});

test("predictChannelClassification routes through the custom_api provider end to end", async () => {
  await clearChannelStore();
  await clearVideoDatabase();
  await saveAISettings({
    provider: "custom_api",
    apiKey: "secret-key",
    apiEndpoint: "https://example.test/classify",
    autoClassify: true,
    confidenceThreshold: 0.7,
  });

  await withFetch(async () => ({
    json: async () => ({ macro: "Productivity", micro: "Coding", confidence: 0.95, reason: "Remote classification" }),
  }), async () => {
    const record = await predictChannelClassification({
      channelId: "UC_END_TO_END",
      channelName: "End To End Channel",
      title: "Whatever the remote provider says goes",
    });
    assert.equal(record.classification.macro, "Productivity");
    assert.equal(record.classification.micro, "Coding");
    assert.equal(record.source, "predicted");
  });

  const stored = await getChannel("UC_END_TO_END");
  assert.equal(stored.classification.micro, "Coding");

  await saveAISettings({ provider: "heuristic", apiKey: "", apiEndpoint: "" });
});
