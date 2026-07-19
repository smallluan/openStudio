const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPLORE_TAB_MAX_LIVE,
  createExploreTab,
  touchExploreTab,
  reconcileExploreTabLifecycle,
  hibernateIdleExploreTabs,
} = require("./explore-tab-lifecycle.cjs");

/** @param {Partial<import("./explore-tab-lifecycle.cjs")>} overrides */
function tab(overrides) {
  const base = createExploreTab("https://example.com", 1_000);
  return { ...base, ...overrides };
}

describe("explore-tab-lifecycle", () => {
  it("keeps only maxLive tabs mounted and hibernates the rest", () => {
    const a = tab({ id: "a", lastActiveAt: 100, hibernated: false });
    const b = tab({ id: "b", lastActiveAt: 200, hibernated: false });
    const c = tab({ id: "c", lastActiveAt: 300, hibernated: false });
    const d = tab({ id: "d", lastActiveAt: 400, hibernated: false });
    const next = reconcileExploreTabLifecycle([a, b, c, d], "d", { maxLive: 3 });
    assert.equal(next.find((t) => t.id === "d")?.hibernated, false);
    assert.equal(next.find((t) => t.id === "c")?.hibernated, false);
    assert.equal(next.find((t) => t.id === "b")?.hibernated, false);
    assert.equal(next.find((t) => t.id === "a")?.hibernated, true);
  });

  it("always keeps the active tab live even if it is the oldest", () => {
    const a = tab({ id: "a", lastActiveAt: 10, hibernated: true });
    const b = tab({ id: "b", lastActiveAt: 300, hibernated: false });
    const c = tab({ id: "c", lastActiveAt: 200, hibernated: false });
    const d = tab({ id: "d", lastActiveAt: 100, hibernated: false });
    const next = reconcileExploreTabLifecycle([a, b, c, d], "a", { maxLive: 3 });
    assert.equal(next.find((t) => t.id === "a")?.hibernated, false);
    const live = next.filter((t) => !t.hibernated && t.url);
    assert.ok(live.length <= 3);
    assert.ok(live.some((t) => t.id === "a"));
  });

  it("touchExploreTab wakes a hibernated tab", () => {
    const a = tab({ id: "a", hibernated: true, lastActiveAt: 1 });
    const next = touchExploreTab([a], "a", 9_999);
    assert.equal(next[0].hibernated, false);
    assert.equal(next[0].lastActiveAt, 9_999);
  });

  it("hibernateIdleExploreTabs discards stale inactive live tabs", () => {
    const active = tab({ id: "active", lastActiveAt: 10_000, hibernated: false });
    const stale = tab({ id: "stale", lastActiveAt: 1_000, hibernated: false });
    const next = hibernateIdleExploreTabs([active, stale], "active", {
      idleMs: 5_000,
      now: 10_000,
    });
    assert.equal(next.find((t) => t.id === "active")?.hibernated, false);
    assert.equal(next.find((t) => t.id === "stale")?.hibernated, true);
  });

  it("exposes a small warm-cache default", () => {
    assert.ok(EXPLORE_TAB_MAX_LIVE >= 2);
    assert.ok(EXPLORE_TAB_MAX_LIVE <= 5);
  });
});
