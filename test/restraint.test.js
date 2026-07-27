const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateMathPuzzle,
  resolveRestraintType,
  REFLECTION_QUESTIONS,
  getActiveRule,
  grantRestraintPass,
  hasActiveRestraintPass,
  saveRestraintPasses,
  normalizeDomain,
} = require("../common.js");

test("generateMathPuzzle: generates valid single-digit arithmetic puzzle and correct answer", () => {
  for (let i = 0; i < 20; i++) {
    const puzzle = generateMathPuzzle();
    assert.ok(puzzle.question.includes("="));
    assert.equal(typeof puzzle.answer, "number");
    assert.ok(!Number.isNaN(puzzle.answer));

    // Verify arithmetic evaluation
    if (puzzle.question.includes("+")) {
      const parts = puzzle.question.split("+").map((s) => parseInt(s.trim(), 10));
      assert.equal(parts[0] + parts[1], puzzle.answer);
    } else if (puzzle.question.includes("×")) {
      const parts = puzzle.question.split("×").map((s) => parseInt(s.trim(), 10));
      assert.equal(parts[0] * parts[1], puzzle.answer);
    } else if (puzzle.question.includes("-")) {
      const parts = puzzle.question.split("-").map((s) => parseInt(s.trim(), 10));
      assert.equal(parts[0] - parts[1], puzzle.answer);
    }
  }
});

test("resolveRestraintType: resolves valid restraint types and handles 'random'", () => {
  assert.equal(resolveRestraintType("countdown"), "countdown");
  assert.equal(resolveRestraintType("confirmation"), "confirmation");
  assert.equal(resolveRestraintType("quote"), "quote");
  assert.equal(resolveRestraintType("reflection"), "reflection");
  assert.equal(resolveRestraintType("math"), "math");
  assert.equal(resolveRestraintType("invalid_type"), "countdown");

  // Random selection should resolve to one of the 5 concrete types
  const validConcreteTypes = ["countdown", "confirmation", "quote", "reflection", "math"];
  for (let i = 0; i < 15; i++) {
    const resolved = resolveRestraintType("random");
    assert.ok(validConcreteTypes.includes(resolved));
  }
});

test("getActiveRule: returns restraint configuration properties", () => {
  const entry = {
    mode: "restraint",
    restraintType: "math",
    countdownSeconds: 20,
  };

  const rule = getActiveRule(entry);
  assert.equal(rule.active, true);
  assert.equal(rule.mode, "restraint");
  assert.equal(rule.restraintType, "math");
  assert.equal(rule.countdownSeconds, 20);
});

test("normalizeDomain: normalizes URLs, schemes, www, subdomains, ports, and paths", () => {
  assert.equal(normalizeDomain("youtube.com"), "youtube.com");
  assert.equal(normalizeDomain("www.youtube.com"), "youtube.com");
  assert.equal(normalizeDomain("https://www.youtube.com/watch?v=123"), "youtube.com");
  assert.equal(normalizeDomain("http://m.youtube.com:8080/feed?g=1#hash"), "m.youtube.com");
  assert.equal(normalizeDomain("  REDDIT.COM/r/stoicism/ "), "reddit.com");
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain(null), "");
});

test("Restraint Pass Lifecycle: grantRestraintPass & hasActiveRestraintPass", async () => {
  await saveRestraintPasses({});

  const domain = "reddit.com";
  assert.equal(await hasActiveRestraintPass(domain), false);

  // Grant pass for 15 minutes
  await grantRestraintPass(domain, 15);
  assert.equal(await hasActiveRestraintPass(domain), true);

  // Check multiple times — pass must NOT be consumed or invalidated on first check
  assert.equal(await hasActiveRestraintPass(domain), true);
  assert.equal(await hasActiveRestraintPass(domain), true);

  // Expired pass check
  await saveRestraintPasses({
    [domain]: { grantedAt: Date.now() - 3600000, expiresAt: Date.now() - 1000 },
  });
  assert.equal(await hasActiveRestraintPass(domain), false);
});

test("Restraint Pass Domain Matching: handles www, subdomains, protocols, and trailing slashes", async () => {
  await saveRestraintPasses({});

  // 1. Grant pass for www.youtube.com -> covers youtube.com, www.youtube.com, subdomains, and full URLs
  await grantRestraintPass("www.youtube.com", 15);
  assert.equal(await hasActiveRestraintPass("youtube.com"), true);
  assert.equal(await hasActiveRestraintPass("www.youtube.com"), true);
  assert.equal(await hasActiveRestraintPass("m.youtube.com"), true);
  assert.equal(await hasActiveRestraintPass("https://www.youtube.com/watch?v=abc"), true);

  await saveRestraintPasses({});

  // 2. Grant pass for bare domain reddit.com -> covers old.reddit.com and full post URL
  await grantRestraintPass("reddit.com", 15);
  assert.equal(await hasActiveRestraintPass("old.reddit.com"), true);
  assert.equal(await hasActiveRestraintPass("https://old.reddit.com/r/stoicism/comments/1"), true);
});

test("REFLECTION_QUESTIONS: provides a non-empty collection of mindful reflection prompts", () => {
  assert.ok(Array.isArray(REFLECTION_QUESTIONS));
  assert.ok(REFLECTION_QUESTIONS.length >= 5);
  REFLECTION_QUESTIONS.forEach((q) => {
    assert.equal(typeof q, "string");
    assert.ok(q.length > 10);
  });
});
