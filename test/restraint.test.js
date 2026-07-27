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

test("Restraint Pass Lifecycle: grantRestraintPass & hasActiveRestraintPass", async () => {
  await saveRestraintPasses({});

  const domain = "reddit.com";
  assert.equal(await hasActiveRestraintPass(domain), false);

  // Grant pass for 15 minutes
  await grantRestraintPass(domain, 15);
  assert.equal(await hasActiveRestraintPass(domain), true);

  // Expired pass check
  await saveRestraintPasses({
    [domain]: { grantedAt: Date.now() - 3600000, expiresAt: Date.now() - 1000 },
  });
  assert.equal(await hasActiveRestraintPass(domain), false);
});

test("REFLECTION_QUESTIONS: provides a non-empty collection of mindful reflection prompts", () => {
  assert.ok(Array.isArray(REFLECTION_QUESTIONS));
  assert.ok(REFLECTION_QUESTIONS.length >= 5);
  REFLECTION_QUESTIONS.forEach((q) => {
    assert.equal(typeof q, "string");
    assert.ok(q.length > 10);
  });
});
