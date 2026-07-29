// progression-store.js is explicitly not part of the engine/model test bar
// (02-ARCHITECTURE.md §8 excludes its "chrome bindings" and leaves them to
// manual verification), but defaultProgressionState()/migrateProgressionState()
// are pure data-shaping — no chrome.* calls — and the I1/I2 write guards are
// cheap to exercise with a mocked `chrome`. Covering those here closes the
// gap without duplicating what the manual checklist already owns.

const test = require("node:test");
const assert = require("node:assert/strict");

const { PROGRESSION_SCHEMA_VERSION } = require("../progression-model.js");

function freshStoreModule() {
  // Each require of progression-store.js in a fresh cache entry gets its own
  // module-level `cachedState`, so tests don't leak state into each other
  // via the shared require cache.
  delete require.cache[require.resolve("../progression-store.js")];
  return require("../progression-store.js");
}

test("defaultProgressionState: matches the documented shape and schema version", () => {
  const { defaultProgressionState } = freshStoreModule();
  const s = defaultProgressionState();
  assert.equal(s.version, PROGRESSION_SCHEMA_VERSION);
  assert.equal(s.level.xp, 0);
  assert.equal(s.level.level, 1);
  assert.equal(s.level.rankId, "observer");
  assert.equal(s.level.lastLevelUp, null);
  assert.equal(s.streaks.discipline.current, 0);
  assert.deepEqual(s.streaks.rules, {});
  assert.equal(s.lifetime.daysTracked, 0);
  assert.deepEqual(s.lifetime.refusalsByDomain, {});
  assert.deepEqual(s.days, []);
  assert.deepEqual(s.weeks, []);
  assert.deepEqual(s.months, []);
  assert.equal(s.settlement.lastSettledDate, null);
  assert.equal(typeof s.today.date, "string");
  assert.equal(s.config.leisureCeilingMinutes, 60);
  assert.equal(s.config.focusTarget, 60);
});

test("migrateProgressionState: a missing/invalid raw state returns the default shape", () => {
  const { migrateProgressionState, defaultProgressionState } = freshStoreModule();
  const fromNull = migrateProgressionState(null);
  const fromUndefined = migrateProgressionState(undefined);
  const fromGarbage = migrateProgressionState("not an object");
  const base = defaultProgressionState();
  // today.date is generated per-call from todayStr(); compare everything else.
  for (const s of [fromNull, fromUndefined, fromGarbage]) {
    assert.equal(s.version, base.version);
    assert.deepEqual(s.level, base.level);
    assert.deepEqual(s.days, []);
  }
});

test("migrateProgressionState: forces the current schema version regardless of what raw carried", () => {
  const { migrateProgressionState } = freshStoreModule();
  const migratedOld = migrateProgressionState({ version: 0 });
  const migratedFuture = migrateProgressionState({ version: 999 });
  assert.equal(migratedOld.version, PROGRESSION_SCHEMA_VERSION);
  assert.equal(migratedFuture.version, PROGRESSION_SCHEMA_VERSION);
});

test("migrateProgressionState: settled days/weeks/months pass through byte-for-byte, never recomputed (I3)", () => {
  const { migrateProgressionState } = freshStoreModule();
  const days = [{ d: "2026-07-01", t: 3600, h: 1, xp: 105, st: 3 }];
  const weeks = [{ w: "2026-W27", held: 6, xp: 110 }];
  const months = [{ m: "2026-07", held: 24 }];
  const migrated = migrateProgressionState({ version: 1, days, weeks, months });
  assert.deepEqual(migrated.days, days);
  assert.deepEqual(migrated.weeks, weeks);
  assert.deepEqual(migrated.months, months);
});

test("migrateProgressionState: a corrupt days/weeks/months field coerces to an empty array rather than throwing", () => {
  const { migrateProgressionState } = freshStoreModule();
  const migrated = migrateProgressionState({ version: 1, days: "oops", weeks: null, months: 42 });
  assert.deepEqual(migrated.days, []);
  assert.deepEqual(migrated.weeks, []);
  assert.deepEqual(migrated.months, []);
});

test("migrateProgressionState: merges nested sections instead of replacing them, so a partial prior shape still gets new defaults", () => {
  const { migrateProgressionState } = freshStoreModule();
  const migrated = migrateProgressionState({
    version: 1,
    level: { xp: 500 }, // missing `level`/`rankId`/`lastLevelUp`
    lifetime: { daysTracked: 12 }, // missing every other lifetime field
  });
  assert.equal(migrated.level.xp, 500);
  assert.equal(migrated.level.level, 1); // backfilled default
  assert.equal(migrated.lifetime.daysTracked, 12);
  assert.equal(migrated.lifetime.refusals, 0); // backfilled default
  assert.deepEqual(migrated.lifetime.refusalsByDomain, {});
});

test("migrateProgressionState: an invalid `today` (no date) falls back to a fresh today rather than an unusable partial", () => {
  const { migrateProgressionState } = freshStoreModule();
  const migrated = migrateProgressionState({ version: 1, today: { gatesShown: { x: 1 } } });
  assert.equal(typeof migrated.today.date, "string");
  assert.deepEqual(migrated.today.gatesShown, {});
});

test("migrateProgressionState: a valid `today` is preserved and merged with defaults", () => {
  const { migrateProgressionState } = freshStoreModule();
  const migrated = migrateProgressionState({
    version: 1,
    today: { date: "2026-07-27", gatesShown: { "x.example.com": 2 }, gatesPassed: {} },
  });
  assert.equal(migrated.today.date, "2026-07-27");
  assert.deepEqual(migrated.today.gatesShown, { "x.example.com": 2 });
});

test("loadProgression/getProgressionSync: fall back to the default state when chrome.storage is unavailable (Node/test environment)", async () => {
  const { loadProgression, getProgressionSync, defaultProgressionState } = freshStoreModule();
  const before = global.chrome;
  delete global.chrome;
  try {
    const loaded = await loadProgression();
    assert.equal(loaded.version, defaultProgressionState().version);
    assert.equal(getProgressionSync().version, defaultProgressionState().version);
  } finally {
    if (before !== undefined) global.chrome = before;
  }
});

test("saveProgression: refuses to write from a page context (no importScripts) — I1", async () => {
  const { saveProgression } = freshStoreModule();
  const before = global.chrome;
  const beforeImportScripts = global.importScripts;
  let wrote = null;
  delete global.importScripts; // page context: not a service worker
  global.chrome = { storage: { local: { async set(obj) { wrote = obj; } } } };
  try {
    await saveProgression({ version: 1 });
    assert.equal(wrote, null, "a page context must never write progression state");
  } finally {
    global.chrome = before;
    if (beforeImportScripts !== undefined) global.importScripts = beforeImportScripts;
  }
});

test("saveProgression: writes to chrome.storage.local when running as the service worker", async () => {
  const { saveProgression } = freshStoreModule();
  const before = global.chrome;
  const beforeImportScripts = global.importScripts;
  let wrote = null;
  global.importScripts = () => {}; // service worker context
  global.chrome = { storage: { local: { async set(obj) { wrote = obj; } } } };
  try {
    const state = { version: 1, marker: "abc" };
    await saveProgression(state);
    assert.equal(wrote.progression.marker, "abc");
  } finally {
    global.chrome = before;
    if (beforeImportScripts !== undefined) global.importScripts = beforeImportScripts;
    else delete global.importScripts;
  }
});

test("flushProgressionSave: forces an immediate write, bypassing the debounce timer", async () => {
  const { scheduleProgressionSave, flushProgressionSave } = freshStoreModule();
  const before = global.chrome;
  const beforeImportScripts = global.importScripts;
  let writes = 0;
  global.importScripts = () => {};
  global.chrome = { storage: { local: { async set() { writes += 1; } } } };
  try {
    scheduleProgressionSave({ version: 1 });
    assert.equal(writes, 0, "the debounced write must not have fired yet");
    await flushProgressionSave();
    assert.equal(writes, 1);
  } finally {
    global.chrome = before;
    if (beforeImportScripts !== undefined) global.importScripts = beforeImportScripts;
    else delete global.importScripts;
  }
});

test("sendProgressionEvent: a no-op when chrome.runtime is unavailable, never throws", async () => {
  const { sendProgressionEvent } = freshStoreModule();
  const before = global.chrome;
  delete global.chrome;
  try {
    await assert.doesNotReject(() => sendProgressionEvent("gate_shown", { domain: "x.example.com" }));
  } finally {
    if (before !== undefined) global.chrome = before;
  }
});

test("sendProgressionEvent: posts a PROGRESSION_EVENT message with the event type and payload, and swallows lastError", async () => {
  const { sendProgressionEvent } = freshStoreModule();
  const before = global.chrome;
  let sent = null;
  global.chrome = {
    runtime: {
      lastError: { message: "no receiving end" },
      sendMessage(msg, cb) {
        sent = msg;
        cb();
      },
    },
  };
  try {
    await assert.doesNotReject(() => sendProgressionEvent("gate_passed", { domain: "x.example.com" }));
    assert.deepEqual(sent, { type: "PROGRESSION_EVENT", eventType: "gate_passed", payload: { domain: "x.example.com" } });
  } finally {
    global.chrome = before;
  }
});
