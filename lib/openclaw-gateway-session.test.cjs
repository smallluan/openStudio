/**
 * Unit tests for shared gateway session acquire / abort isolation.
 * Run: node --test lib/openclaw-gateway-session.test.cjs
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const wsPath = require.resolve("./openclaw-gateway-ws.cjs");
const sessionPath = require.resolve("./openclaw-gateway-session.cjs");
const bpPath = require.resolve("./openclaw-gateway-rpc-backpressure.cjs");

/** @type {Array<() => void>} */
let pendingConnectResolvers = [];
/** @type {number} */
let openCalls = 0;
/** @type {AbortSignal[]} */
let openSignals = [];

function installMocks() {
  pendingConnectResolvers = [];
  openCalls = 0;
  openSignals = [];

  require.cache[wsPath] = {
    id: wsPath,
    filename: wsPath,
    loaded: true,
    exports: {
      resolveGateway(cfg) {
        return {
          baseUrl: "http://127.0.0.1:19002",
          wsUrl: "ws://127.0.0.1:19002",
          token: "t",
          sessionKey: "agent:dev:main",
          ...(cfg && typeof cfg === "object" ? {} : {}),
        };
      },
      openGatewayClient(_opts, signal) {
        openCalls += 1;
        openSignals.push(signal);
        return new Promise((resolve, reject) => {
          let settled = false;
          /** @type {(() => void) | null} */
          let resolver = null;
          const settle = (fn) => {
            if (settled) return;
            settled = true;
            if (resolver) {
              const idx = pendingConnectResolvers.indexOf(resolver);
              if (idx >= 0) pendingConnectResolvers.splice(idx, 1);
              resolver = null;
            }
            fn();
          };
          const onAbort = () => {
            settle(() => reject(new DOMException("aborted", "AbortError")));
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
          resolver = () => {
            signal?.removeEventListener("abort", onAbort);
            settle(() =>
              resolve({
                request: async () => ({}),
                onEvent: () => () => {},
                close: () => {},
                hello: {},
              }),
            );
          };
          pendingConnectResolvers.push(resolver);
        });
      },
    },
  };

  require.cache[bpPath] = {
    id: bpPath,
    filename: bpPath,
    loaded: true,
    exports: {
      wrapGatewayClientWithBackpressure(client) {
        return client;
      },
    },
  };

  delete require.cache[sessionPath];
  return require("./openclaw-gateway-session.cjs");
}

function flushConnect() {
  const resolvers = pendingConnectResolvers.splice(0);
  for (const r of resolvers) r();
}

describe("raceWithCallerAbort", () => {
  it("rejects when caller aborts without rejecting the underlying promise side effects", async () => {
    const session = installMocks();
    let underlyingSettled = false;
    const underlying = new Promise((resolve) => {
      setTimeout(() => {
        underlyingSettled = true;
        resolve("ok");
      }, 30);
    });
    const ac = new AbortController();
    const raced = session.raceWithCallerAbort(underlying, ac.signal);
    ac.abort();
    await assert.rejects(raced, (err) => err && err.name === "AbortError");
    await underlying;
    assert.equal(underlyingSettled, true);
  });
});

describe("acquireGatewaySession abort isolation", () => {
  /** @type {any} */
  let session;

  beforeEach(() => {
    session = installMocks();
    session.__resetGatewaySessionForTests();
  });

  afterEach(() => {
    session?.__resetGatewaySessionForTests?.();
    delete require.cache[sessionPath];
    delete require.cache[wsPath];
    delete require.cache[bpPath];
  });

  it("does not abort shared handshake when a short-lived poller aborts", async () => {
    const resolved = {
      baseUrl: "http://127.0.0.1:19002",
      wsUrl: "ws://127.0.0.1:19002",
      token: "t",
      sessionKey: "agent:dev:main",
    };

    const pollAc = new AbortController();
    const chatAc = new AbortController();

    const pollP = session.acquireGatewaySession(resolved, pollAc.signal);
    // Let poller start the shared connect
    await new Promise((r) => setImmediate(r));
    assert.equal(openCalls, 1);

    const chatP = session.acquireGatewaySession(resolved, chatAc.signal);
    // Poller budget expires — must NOT kill the shared handshake
    pollAc.abort();
    await assert.rejects(pollP, (err) => err && err.name === "AbortError");

    assert.equal(openCalls, 1);
    assert.equal(openSignals[0]?.aborted, false);

    flushConnect();
    const client = await chatP;
    assert.ok(client);
    assert.equal(openCalls, 1);
  });

  it("retries connect after invalidate mid-handshake", async () => {
    const resolved = {
      baseUrl: "http://127.0.0.1:19002",
      wsUrl: "ws://127.0.0.1:19002",
      token: "t",
      sessionKey: "agent:dev:main",
    };
    const chatAc = new AbortController();
    const p = session.acquireGatewaySession(resolved, chatAc.signal);
    await new Promise((r) => setImmediate(r));
    assert.equal(openCalls, 1);

    session.invalidateGatewaySession();
    // Wait until a retry has registered a fresh connect resolver
    for (let i = 0; i < 50 && pendingConnectResolvers.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(openCalls >= 2, `expected retry open, got ${openCalls}`);
    assert.equal(pendingConnectResolvers.length, 1);
    flushConnect();
    const client = await p;
    assert.ok(client);
  });
});
