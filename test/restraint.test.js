const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateHardPuzzle,
  validateOpenReason,
  RESTRAINT_WAIT_SECONDS,
  RESTRAINT_PUZZLE_STREAK_REQUIRED,
  RESTRAINT_MIN_REASON_WORDS,
  REFLECTION_QUESTIONS,
  getActiveRule,
  grantRestraintPass,
  hasActiveRestraintPass,
  saveRestraintPasses,
  normalizeDomain,
} = require("../common.js");

// Left-to-right evaluator matching how generateHardPuzzle built the
// question, used to verify the puzzle's stated answer independently of the
// generator's own arithmetic.
function evaluateLeftToRight(question) {
  const cleaned = question.replace(/=\s*\?/, "").trim();
  const tokens = cleaned.split(/\s+/);
  let result = Number(tokens[0]);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const num = Number(tokens[i + 1]);
    if (op === "+") result += num;
    else if (op === "-") result -= num;
    else if (op === "×") result *= num;
  }
  return result;
}

test("generateHardPuzzle: generates genuinely harder (two-digit+) arithmetic with a correct answer", () => {
  let sawMultiTerm = false;
  let sawTwoDigitOperand = false;

  for (let i = 0; i < 50; i++) {
    const puzzle = generateHardPuzzle();
    assert.ok(puzzle.question.includes("="));
    assert.equal(typeof puzzle.answer, "number");
    assert.ok(!Number.isNaN(puzzle.answer));
    assert.equal(evaluateLeftToRight(puzzle.question), puzzle.answer);

    const operandCount = puzzle.question.split(/[+\-×]/).length;
    if (operandCount > 2) sawMultiTerm = true;
    if (/\b\d{2,}\b/.test(puzzle.question)) sawTwoDigitOperand = true;
  }

  // Across enough samples we should see both the multi-term chains and
  // two-digit operands that make this harder than the old single-digit
  // "2 + 3 = ?" style puzzle.
  assert.ok(sawMultiTerm, "expected at least one multi-term puzzle across samples");
  assert.ok(sawTwoDigitOperand, "expected at least one two-digit operand across samples");
});

test("RESTRAINT_WAIT_SECONDS / RESTRAINT_PUZZLE_STREAK_REQUIRED: fixed, non-trivial friction", () => {
  assert.equal(RESTRAINT_WAIT_SECONDS, 60);
  assert.ok(RESTRAINT_PUZZLE_STREAK_REQUIRED >= 2);
});

test("validateOpenReason: rejects low-effort responses", () => {
  assert.equal(validateOpenReason("").valid, false);
  assert.equal(validateOpenReason("ok").valid, false);
  assert.equal(validateOpenReason("yes").valid, false);
  assert.equal(validateOpenReason(".").valid, false);
  assert.equal(validateOpenReason("asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf").valid, false);
  assert.equal(validateOpenReason("aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa").valid, false);
});

test("validateOpenReason: accepts a genuine, specific explanation", () => {
  const result = validateOpenReason(
    "I need to check a work email thread about tomorrow's client meeting before I lose the context."
  );
  assert.equal(result.valid, true);
});

test("validateOpenReason: enforces the minimum word count", () => {
  const distinctWords = [
    "need", "to", "check", "an", "important", "work", "email", "before",
    "the", "meeting", "starts", "this", "afternoon", "at", "the", "office",
  ];

  const tooFew = distinctWords.slice(0, RESTRAINT_MIN_REASON_WORDS - 1).join(" ");
  assert.equal(validateOpenReason(tooFew).valid, false);

  const enoughWords = distinctWords.slice(0, RESTRAINT_MIN_REASON_WORDS).join(" ");
  assert.equal(validateOpenReason(enoughWords).valid, true);
});

test("getActiveRule: returns schedule/limit configuration properties", () => {
  const entry = {
    mode: "restraint",
  };

  const rule = getActiveRule(entry);
  assert.equal(rule.active, true);
  assert.equal(rule.mode, "restraint");
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
