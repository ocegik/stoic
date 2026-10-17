// Covers the logic in background-logic.js that's most likely to silently
// break: the date-rollover behavior in ensureReset() and elapsed-time
// tracking (clampElapsed / threshold crossing). Pure functions only — no
// chrome.* APIs are touched, so this runs under plain Node.
//
// Run with: node --test
// or:       npm test

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_ELAPSED_SECONDS,
  MAX_HISTORY_DAYS,
  ensureReset,
  matchSite,
  getDomain,
  normalizeUrl,
  clampElapsed,
  crossedThreshold,
  markThresholdsUpTo,
  createCoalescingRunner,
} = require("../background-logic.js");

// A controllable "task": each call returns a promise that stays pending
// until the test explicitly resolves it, so overlapping run() calls can
// be triggered deterministically.
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeEntry(overrides = {}) {
  return {
    mode: "limit",
    limitMinutes: 30,
    usedSeconds: 0,
    lastReset: "2026-07-25",
    history: [],
    action: "page",
    redirectUrl: "",
    paused: false,
    timesTripped: 0,
    createdAt: "2026-07-01",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// ensureReset() — date rollover
// ---------------------------------------------------------------------

test("ensureReset: no-ops when lastReset is already today", () => {
  const entry = makeEntry({ lastReset: "2026-07-26", usedSeconds: 120 });
  const changed = ensureReset(entry, "2026-07-26");

  assert.equal(changed, false);
  assert.equal(entry.usedSeconds, 120, "usedSeconds must not be touched on a same-day call");
  assert.equal(entry.lastReset, "2026-07-26");
  assert.deepEqual(entry.history, []);
});

test("ensureReset: rolls usedSeconds into history and zeroes it on a new day", () => {
  const entry = makeEntry({ lastReset: "2026-07-25", usedSeconds: 900, history: [] });
  const changed = ensureReset(entry, "2026-07-26");

  assert.equal(changed, true);
  assert.equal(entry.usedSeconds, 0);
  assert.equal(entry.lastReset, "2026-07-26");
  assert.deepEqual(entry.history, [{ date: "2026-07-25", seconds: 900 }]);
});

test("ensureReset: does not push a history entry for a day with zero usage", () => {
  const entry = makeEntry({ lastReset: "2026-07-25", usedSeconds: 0, history: [{ date: "2026-07-20", seconds: 60 }] });
  ensureReset(entry, "2026-07-26");

  assert.deepEqual(entry.history, [{ date: "2026-07-20", seconds: 60 }]);
});

test("ensureReset: caps history at MAX_HISTORY_DAYS, dropping the oldest entries", () => {
  const history = [];
  for (let i = 0; i < MAX_HISTORY_DAYS; i++) {
    history.push({ date: `2026-07-${10 + i}`, seconds: 100 + i });
  }
  const entry = makeEntry({ lastReset: "2026-07-25", usedSeconds: 500, history });
  ensureReset(entry, "2026-07-26");

  assert.equal(entry.history.length, MAX_HISTORY_DAYS);
  // Oldest (2026-07-10) should have been dropped; the newly-rolled day is last.
  assert.equal(entry.history[0].date, "2026-07-11");
  assert.deepEqual(entry.history[entry.history.length - 1], { date: "2026-07-25", seconds: 500 });
});

test("ensureReset: clears pre-limit warning flags on rollover so they can fire again", () => {
  const entry = makeEntry({ lastReset: "2026-07-25", usedSeconds: 1700, notified80: true, notified90: true });
  ensureReset(entry, "2026-07-26");

  assert.equal(entry.notified80, false);
  assert.equal(entry.notified90, false);
});

test("ensureReset: a same-day call leaves warning flags alone", () => {
  const entry = makeEntry({ lastReset: "2026-07-26", notified80: true, notified90: false });
  ensureReset(entry, "2026-07-26");

  assert.equal(entry.notified80, true);
  assert.equal(entry.notified90, false);
});

test("ensureReset: handles a brand-new entry with no history array", () => {
  const entry = { lastReset: "2026-07-25", usedSeconds: 42 };
  ensureReset(entry, "2026-07-26");

  assert.deepEqual(entry.history, [{ date: "2026-07-25", seconds: 42 }]);
  assert.equal(entry.usedSeconds, 0);
});

test("ensureReset: rolling across more than one missed day still resets cleanly", () => {
  // e.g. the browser wasn't opened for several days.
  const entry = makeEntry({ lastReset: "2026-07-20", usedSeconds: 300 });
  ensureReset(entry, "2026-07-26");

  assert.equal(entry.usedSeconds, 0);
  assert.equal(entry.lastReset, "2026-07-26");
  assert.deepEqual(entry.history, [{ date: "2026-07-20", seconds: 300 }]);
});

// ---------------------------------------------------------------------
// clampElapsed() — elapsed-time tracking
// ---------------------------------------------------------------------

test("clampElapsed: passes typical gaps through unchanged", () => {
  assert.equal(clampElapsed(5), 5);
  assert.equal(clampElapsed(0), 0);
  assert.equal(clampElapsed(59.7), 59.7);
});

test("clampElapsed: clamps a large gap (e.g. sleep/wake) to MAX_ELAPSED_SECONDS", () => {
  assert.equal(clampElapsed(60 * 60 * 4), MAX_ELAPSED_SECONDS);
  assert.equal(clampElapsed(MAX_ELAPSED_SECONDS + 0.001), MAX_ELAPSED_SECONDS);
});

test("clampElapsed: never returns a value above MAX_ELAPSED_SECONDS at the boundary", () => {
  assert.equal(clampElapsed(MAX_ELAPSED_SECONDS), MAX_ELAPSED_SECONDS);
});

test("clampElapsed: floors negative gaps (clock skew) at zero", () => {
  assert.equal(clampElapsed(-5), 0);
});

// ---------------------------------------------------------------------
// crossedThreshold() / markThresholdsUpTo() — pre-limit warnings
// ---------------------------------------------------------------------

test("crossedThreshold: null below 80%", () => {
  const entry = makeEntry({ usedSeconds: 10 * 60 }); // 10 of 30 min
  assert.equal(crossedThreshold(entry, 30 * 60), null);
});

test("crossedThreshold: reports 80 once usage reaches 80%, not before", () => {
  const limitSeconds = 30 * 60;
  const entry = makeEntry({ usedSeconds: 24 * 60 - 1 }); // just under 80%
  assert.equal(crossedThreshold(entry, limitSeconds), null);

  entry.usedSeconds = 24 * 60; // exactly 80%
  assert.equal(crossedThreshold(entry, limitSeconds).pct, 80);
});

test("crossedThreshold: prefers 90 over 80 when both apply", () => {
  const entry = makeEntry({ usedSeconds: 29 * 60 }); // 96% of 30 min
  assert.equal(crossedThreshold(entry, 30 * 60).pct, 90);
});

test("crossedThreshold: null once every applicable threshold has been notified", () => {
  const entry = makeEntry({ usedSeconds: 29 * 60 });
  markThresholdsUpTo(entry, 90); // the normal path: notifying at 90 also marks 80
  assert.equal(crossedThreshold(entry, 30 * 60), null);
});

test("crossedThreshold: still reports 80 if only 90 was marked (defensive, shouldn't normally happen)", () => {
  // In practice markThresholdsUpTo(entry, 90) always marks both flags
  // together, so this combination shouldn't arise. But if it ever did,
  // the function should still behave sanely rather than silently
  // swallowing the 80% warning.
  const entry = makeEntry({ usedSeconds: 29 * 60, notified90: true, notified80: false });
  assert.equal(crossedThreshold(entry, 30 * 60).pct, 80);
});

test("crossedThreshold: null when there's no limit configured", () => {
  const entry = makeEntry({ usedSeconds: 1000 });
  assert.equal(crossedThreshold(entry, 0), null);
});

test("markThresholdsUpTo: marks 80 and 90 flags at once when jumping straight past 90%", () => {
  const entry = makeEntry();
  markThresholdsUpTo(entry, 90);
  assert.equal(entry.notified80, true);
  assert.equal(entry.notified90, true);
});

test("markThresholdsUpTo: marking 80 leaves 90 untouched", () => {
  const entry = makeEntry();
  markThresholdsUpTo(entry, 80);
  assert.equal(entry.notified80, true);
  assert.equal(entry.notified90, undefined);
});

// ---------------------------------------------------------------------
// matchSite() / getDomain() / normalizeUrl() — sanity coverage
// ---------------------------------------------------------------------

test("matchSite: exact match", () => {
  const sites = { "youtube.com": {}, "reddit.com": {} };
  assert.equal(matchSite("youtube.com", sites), "youtube.com");
});

test("matchSite: subdomain matches its parent", () => {
  const sites = { "youtube.com": {} };
  assert.equal(matchSite("m.youtube.com", sites), "youtube.com");
});

test("matchSite: unrelated domain does not match a similar-looking one", () => {
  const sites = { "youtube.com": {} };
  assert.equal(matchSite("notyoutube.com", sites), null);
});

test("matchSite: picks the more specific (longer) key when both match", () => {
  const sites = { "google.com": {}, "mail.google.com": {} };
  assert.equal(matchSite("mail.google.com", sites), "mail.google.com");
});

test("getDomain: strips a leading www.", () => {
  assert.equal(getDomain("https://www.youtube.com/watch?v=1"), "youtube.com");
});

test("getDomain: returns null for an unparsable URL", () => {
  assert.equal(getDomain("not a url"), null);
});

test("normalizeUrl: adds https:// when no scheme is present", () => {
  assert.equal(normalizeUrl("example.com/todo"), "https://example.com/todo");
});

test("normalizeUrl: returns null for empty input", () => {
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("   "), null);
});

// ---------------------------------------------------------------------
// createCoalescingRunner() — the tick() concurrency guard
// ---------------------------------------------------------------------

test("createCoalescingRunner: does not overlap two runs — the second waits for the first to finish", async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const gate = deferred();

  const run = createCoalescingRunner(async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await gate.promise;
    concurrent--;
  });

  const first = run(); // starts immediately, blocks on the gate
  const second = run(); // arrives while the first is in flight — coalesced, not run yet

  assert.equal(maxConcurrent, 1, "a second call must not start the task while one is already running");

  gate.resolve();
  await first;
  await second;

  assert.equal(concurrent, 0);
});

test("createCoalescingRunner: a call that arrives mid-run still triggers exactly one more run", async () => {
  let callCount = 0;
  let gate = deferred();

  const run = createCoalescingRunner(async () => {
    callCount++;
    await gate.promise;
  });

  const first = run();
  run(); // coalesced while the first is in flight
  run(); // a second overlapping call — must not queue a second re-run

  gate.resolve();
  await first;
  // Let the coalesced re-run (scheduled in the `finally` block) start and
  // reach its own await point.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(callCount, 2, "exactly one coalesced re-run, not one per overlapping call");

  gate.resolve(); // release the coalesced run too
});

test("createCoalescingRunner: a call after the task has fully settled runs immediately", async () => {
  let callCount = 0;
  const run = createCoalescingRunner(async () => {
    callCount++;
  });

  await run();
  await run();

  assert.equal(callCount, 2);
});

test("createCoalescingRunner: an error in the task is caught and reported, not thrown", async () => {
  const errors = [];
  const run = createCoalescingRunner(
    async () => {
      throw new Error("boom");
    },
    (err) => errors.push(err.message)
  );

  await assert.doesNotReject(run());
  assert.deepEqual(errors, ["boom"]);
});

test("createCoalescingRunner: a failed run still lets a queued call run afterward", async () => {
  let callCount = 0;
  const gate = deferred();

  const run = createCoalescingRunner(async () => {
    callCount++;
    if (callCount === 1) {
      await gate.promise;
      throw new Error("first run fails");
    }
  }, () => {});

  const first = run();
  run(); // coalesced

  gate.resolve();
  await first;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(callCount, 2, "the queued run should still execute even though the first one threw");
});

test("ensureReset archives a zero-second day that had trips, and resets trippedToday", () => {
  const { ensureReset } = require("../background-logic.js");
  const entry = { usedSeconds: 0, trippedToday: 5, lastReset: "2026-07-25", history: [] };
  ensureReset(entry, "2026-07-26");
  assert.deepEqual(entry.history, [{ date: "2026-07-25", seconds: 0, trips: 5 }]);
  assert.equal(entry.trippedToday, 0);
});
