"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  GATEWAY_ANTHROPIC_MESSAGES_DEFAULT_MAX_TOKENS,
  gatewayProviderUsesAnthropicMessages,
  ensureGatewayModelRowDefaults,
  ensureGatewayProviderModelsDefaults,
} = require("./model-providers.cjs");

describe("gatewayProviderUsesAnthropicMessages", () => {
  it("detects anthropic-messages transport", () => {
    assert.equal(gatewayProviderUsesAnthropicMessages("anthropic-messages"), true);
    assert.equal(gatewayProviderUsesAnthropicMessages("openai-completions"), false);
  });
});

describe("ensureGatewayModelRowDefaults", () => {
  it("adds maxTokens for anthropic-messages models", () => {
    const row = { id: "MiniMax-M2.7", name: "MiniMax-M2.7", input: ["text", "image"] };
    assert.equal(ensureGatewayModelRowDefaults(row, "anthropic-messages"), true);
    assert.equal(row.maxTokens, GATEWAY_ANTHROPIC_MESSAGES_DEFAULT_MAX_TOKENS);
  });

  it("leaves openai-completions models unchanged", () => {
    const row = { id: "deepseek-v4-flash", input: ["text"] };
    assert.equal(ensureGatewayModelRowDefaults(row, "openai-completions"), false);
    assert.equal(row.maxTokens, undefined);
  });

  it("does not overwrite a positive maxTokens", () => {
    const row = { id: "MiniMax-M2.7", maxTokens: 4096 };
    assert.equal(ensureGatewayModelRowDefaults(row, "anthropic-messages"), false);
    assert.equal(row.maxTokens, 4096);
  });
});

describe("ensureGatewayProviderModelsDefaults", () => {
  it("patches every model row on anthropic-messages providers", () => {
    const block = {
      api: "anthropic-messages",
      models: [
        { id: "MiniMax-M2.7", input: ["text", "image"] },
        { id: "MiniMax-M2.7-Highspeed", input: ["text"] },
      ],
    };
    assert.equal(ensureGatewayProviderModelsDefaults(block), true);
    assert.equal(block.models[0].maxTokens, GATEWAY_ANTHROPIC_MESSAGES_DEFAULT_MAX_TOKENS);
    assert.equal(block.models[1].maxTokens, GATEWAY_ANTHROPIC_MESSAGES_DEFAULT_MAX_TOKENS);
  });
});
