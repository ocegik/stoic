const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ClassificationContext,
  ClassificationResult,
  ContentExtractorAdapter,
  GenericDomainExtractorAdapter,
  YouTubeExtractorAdapter,
  ChatGPTExtractorAdapter,
  RedditExtractorAdapter,
  ExtractorRegistry,
  ClassifierRule,
  UserOverrideClassifierRule,
  ContentExtractorClassifierRule,
  DomainRuleClassifierRule,
  FallbackClassifierRule,
  ClassificationPipeline,
  ClassificationCache,
  classifyContext,
  getDomainTaxonomy,
} = require("../common.js");

test("ClassificationContext: creation, domain normalization, and URL parsing", () => {
  const ctxFromDomain = ClassificationContext.create("www.youtube.com");
  assert.equal(ctxFromDomain.domain, "youtube.com");

  const ctxFromUrl = ClassificationContext.create("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(ctxFromUrl.domain, "youtube.com");
  assert.equal(ctxFromUrl.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  const ctxFromObj = ClassificationContext.create({
    domain: "https://www.github.com/repo",
    title: "GitHub Repository",
  });
  assert.equal(ctxFromObj.domain, "github.com");
  assert.equal(ctxFromObj.title, "GitHub Repository");

  const serialized = ctxFromUrl.toObject();
  assert.equal(serialized.domain, "youtube.com");
  assert.equal(serialized.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("YouTubeExtractorAdapter: extracts video ID, channel, and shorts from YouTube URLs", () => {
  const adapter = new YouTubeExtractorAdapter();
  assert.equal(adapter.canHandle("youtube.com"), true);
  assert.equal(adapter.canHandle("m.youtube.com"), true);
  assert.equal(adapter.canHandle("youtu.be"), true);
  assert.equal(adapter.canHandle("github.com"), false);

  // Video URL
  const videoCtx = adapter.extract(ClassificationContext.create("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
  assert.equal(videoCtx.videoId, "dQw4w9WgXcQ");
  assert.equal(videoCtx.contentType, "video");

  // Short URL
  const shortCtx = adapter.extract(ClassificationContext.create("https://www.youtube.com/shorts/abcd1234"));
  assert.equal(shortCtx.videoId, "abcd1234");
  assert.equal(shortCtx.contentType, "short");

  // Handle/Channel URL
  const channelCtx = adapter.extract(ClassificationContext.create("https://www.youtube.com/@veritasium"));
  assert.equal(channelCtx.channelName, "veritasium");

  // Channel ID URL
  const channelIdCtx = adapter.extract(ClassificationContext.create("https://www.youtube.com/channel/UC123456789"));
  assert.equal(channelIdCtx.channelId, "UC123456789");

  // Shortened link
  const shortLinkCtx = adapter.extract(ClassificationContext.create("https://youtu.be/xyz987"));
  assert.equal(shortLinkCtx.videoId, "xyz987");
});

test("ChatGPTExtractorAdapter: extracts chat and custom GPT IDs", () => {
  const adapter = new ChatGPTExtractorAdapter();
  assert.equal(adapter.canHandle("chatgpt.com"), true);
  assert.equal(adapter.canHandle("openai.com"), true);

  const chatCtx = adapter.extract(ClassificationContext.create("https://chatgpt.com/c/67890-abc"));
  assert.equal(chatCtx.contentType, "chat");
  assert.equal(chatCtx.metadata.chatId, "67890-abc");

  const gptCtx = adapter.extract(ClassificationContext.create("https://chatgpt.com/g/g-12345-my-gpt"));
  assert.equal(gptCtx.metadata.customGptId, "g-12345-my-gpt");
});

test("RedditExtractorAdapter: extracts subreddit and post ID", () => {
  const adapter = new RedditExtractorAdapter();
  assert.equal(adapter.canHandle("reddit.com"), true);

  const postCtx = adapter.extract(ClassificationContext.create("https://www.reddit.com/r/javascript/comments/123456/title_slug/"));
  assert.equal(postCtx.contentType, "post");
  assert.equal(postCtx.metadata.subreddit, "javascript");
  assert.equal(postCtx.metadata.postId, "123456");
});

test("ExtractorRegistry: routes to correct adapter or falls back to generic", () => {
  const registry = new ExtractorRegistry();
  registry.register(new YouTubeExtractorAdapter());
  registry.register(new RedditExtractorAdapter());

  const ytResult = registry.extract("https://www.youtube.com/watch?v=123");
  assert.equal(ytResult.videoId, "123");

  const genericResult = registry.extract("https://example.org/page");
  assert.equal(genericResult.domain, "example.org");
});

test("ClassificationPipeline: evaluates rules in priority order", () => {
  const pipeline = new ClassificationPipeline();

  pipeline.addRule(new UserOverrideClassifierRule());
  pipeline.addRule(new ContentExtractorClassifierRule());
  pipeline.addRule(new DomainRuleClassifierRule());
  pipeline.addRule(new FallbackClassifierRule());

  // 1. Domain rule
  const domainRes = pipeline.classify({ domain: "github.com" });
  assert.equal(domainRes.micro, "Coding");
  assert.equal(domainRes.source, "domain_rule");

  // 2. User override rule precedence
  const customSites = { "github.com": { microCategory: "Study" } };
  const userRes = pipeline.classify({ domain: "github.com" }, customSites);
  assert.equal(userRes.micro, "Study");
  assert.equal(userRes.source, "user_override");

  // 3. AI-assisted rule
  const aiCtx = new ClassificationContext({
    domain: "youtube.com",
    aiResult: { macro: "Productivity", micro: "Study", confidence: 0.95 },
  });
  const aiRes = pipeline.classify(aiCtx);
  assert.equal(aiRes.micro, "Study");
  assert.equal(aiRes.source, "ai_assisted");
  assert.equal(aiRes.confidence, 0.95);
});

test("ClassificationCache: caches classification results and handles TTL/invalidation", () => {
  const cache = new ClassificationCache(10, 1000);
  const context = ClassificationContext.create("https://youtube.com/watch?v=123");
  const result = new ClassificationResult({ macro: "Leisure", micro: "Streaming", source: "domain_rule" });

  cache.set(context, null, result);
  const cached = cache.get(context, null);
  assert.equal(cached.micro, "Streaming");

  cache.clear();
  assert.equal(cache.get(context, null), null);
});

test("classifyContext and getDomainTaxonomy: integration with context objects", () => {
  const context = new ClassificationContext({
    url: "https://www.youtube.com/watch?v=demo",
    title: "Intro to Physics",
  });

  const fullResult = classifyContext(context);
  assert.equal(fullResult.macro, "Leisure");
  assert.equal(fullResult.micro, "Streaming");

  const tax = getDomainTaxonomy(context);
  assert.deepEqual(tax, { macro: "Leisure", micro: "Streaming" });
});
