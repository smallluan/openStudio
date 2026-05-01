/**
 * Smoke test for `lib/openclaw-gateway-stream.cjs` against a running OpenClaw
 * dev gateway (port 19001 by default).
 *
 * Usage:
 *   node scripts/smoke-gateway.cjs                      # probe only
 *   node scripts/smoke-gateway.cjs "你好"                # probe + chat one turn
 *
 * Set OPENCLAW_GATEWAY_BASE_URL to override the URL.
 */

const {
  probeOpenClawGateway,
  dispatchOpenClawGatewayStream,
} = require("../lib/openclaw-gateway-stream.cjs");

const baseUrl = process.env.OPENCLAW_GATEWAY_BASE_URL || "http://127.0.0.1:19001";
const sessionKey = process.env.OPENCLAW_SESSION_KEY || "agent:dev:dev";

const cfg = {
  openclaw: {
    gatewayBaseUrl: baseUrl,
    sessionKey,
    ...(process.env.OPENCLAW_GATEWAY_TOKEN
      ? { gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN }
      : {}),
  },
};

async function main() {
  process.stdout.write(`[probe] target=${baseUrl} session=${sessionKey}\n`);
  try {
    const r = await probeOpenClawGateway(cfg);
    process.stdout.write(`[probe] ok=${JSON.stringify(r)}\n`);
  } catch (err) {
    process.stdout.write(`[probe] FAIL: ${err?.message ?? err}\n`);
    process.exit(1);
  }

  const userText = process.argv[2];
  if (!userText) {
    process.stdout.write("[chat] (skipped — pass a prompt as argv[2] to test)\n");
    return;
  }

  const ac = new AbortController();
  process.stdout.write(`[chat] sending: ${JSON.stringify(userText)}\n`);
  await dispatchOpenClawGatewayStream(
    cfg,
    [{ role: "user", content: userText }],
    ac.signal,
    (evt) => {
      if (evt.type === "meta") {
        process.stdout.write(`[chat] meta vendor=${evt.vendor} sessionKey=${evt.sessionKey}\n`);
      } else if (evt.type === "thinking") {
        process.stdout.write(`[think] ${evt.delta}`);
      } else if (evt.type === "text") {
        process.stdout.write(`${evt.delta}`);
      } else if (evt.type === "error") {
        process.stdout.write(`\n[chat] ERROR ${evt.message}\n`);
      } else if (evt.type === "info") {
        process.stdout.write(`\n[info] ${evt.message}\n`);
      } else {
        process.stdout.write(`\n[chat] (${evt.type}) ${JSON.stringify(evt)}\n`);
      }
    },
  );
  process.stdout.write("\n[chat] done\n");
}

main().catch((err) => {
  process.stderr.write(`smoke failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
