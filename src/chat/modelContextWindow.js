/**
 * Model context window sizes (approximate, in tokens).
 * Based on official documentation for common models.
 * @param {string} modelId
 * @returns {number} Context window size in tokens
 */
export function getContextWindowSize(modelId) {
  if (!modelId) return 128000;
  
  const id = modelId.toLowerCase();
  
  // Claude models
  if (id.includes('claude-3.5-sonnet') || id.includes('claude-3.5-opus')) return 200000;
  if (id.includes('claude-3-opus') || id.includes('claude-3-sonnet')) return 200000;
  if (id.includes('claude-3-haiku')) return 200000;
  if (id.includes('claude-2')) return 100000;
  if (id.includes('claude')) return 200000;
  
  // GPT-4 models
  if (id.includes('gpt-4-turbo') || id.includes('gpt-4-0125') || id.includes('gpt-4-1106')) return 128000;
  if (id.includes('gpt-4-32k')) return 32768;
  if (id.includes('gpt-4')) return 8192;
  
  // GPT-3.5
  if (id.includes('gpt-3.5-turbo-16k')) return 16384;
  if (id.includes('gpt-3.5-turbo')) return 4096;
  
  // o1 models
  if (id.includes('o1-preview') || id.includes('o1-mini')) return 128000;
  if (id.includes('o1')) return 200000;
  
  // Gemini models
  if (id.includes('gemini-1.5-pro')) return 1000000; // 1M tokens
  if (id.includes('gemini-1.5-flash')) return 1000000;
  if (id.includes('gemini-1.0-pro')) return 32000;
  if (id.includes('gemini')) return 32000;
  
  // DeepSeek models
  if (id.includes('deepseek-v3') || id.includes('deepseek-chat')) return 64000;
  if (id.includes('deepseek-coder')) return 16000;
  if (id.includes('deepseek')) return 64000;
  
  // Qwen models
  if (id.includes('qwen2.5') || id.includes('qwen-2.5')) return 128000;
  if (id.includes('qwen2') || id.includes('qwen-2')) return 32000;
  if (id.includes('qwen')) return 32000;
  
  // Kimi/Moonshot models
  if (id.includes('kimi') || id.includes('moonshot')) return 128000;
  
  // MiniMax models
  if (id.includes('minimax')) return 64000;
  
  // GLM models
  if (id.includes('glm-4')) return 128000;
  if (id.includes('glm')) return 32000;
  
  // Llama models
  if (id.includes('llama-3.1') || id.includes('llama-3.2')) return 128000;
  if (id.includes('llama-3')) return 8192;
  if (id.includes('llama-2')) return 4096;
  
  // Mistral models
  if (id.includes('mistral-large') || id.includes('mistral-medium')) return 32000;
  if (id.includes('mistral-7b')) return 32768;
  if (id.includes('mixtral')) return 32768;
  
  // Default fallback
  return 128000;
}

/** @param {string} fixed */
function trimTrailingZeros(fixed) {
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/\.?0+$/, "");
}

/**
 * Compact token count for context meter (e.g. 11745 → "11.75k", 200000 → "200k").
 * @param {number} tokens
 * @returns {string}
 */
export function formatContextTokensK(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n < 0) return "0k";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    const decimals = v >= 10 ? 0 : v >= 1 ? 1 : 2;
    return `${trimTrailingZeros(v.toFixed(decimals))}m`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    if (v >= 100) return `${Math.round(v)}k`;
    const rounded = Math.round(v * 100) / 100;
    return `${trimTrailingZeros(rounded.toFixed(2))}k`;
  }
  return String(Math.round(n));
}

/**
 * Format context window size for display.
 * @param {number} tokens
 * @returns {string}
 */
export function formatContextWindow(tokens) {
  return formatContextTokensK(tokens);
}