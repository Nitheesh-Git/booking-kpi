/**
 * LLM client with Groq primary (3-key round-robin) and OpenRouter fallback.
 *
 * Groq model   : qwen/qwen3.8-27b, verified 2026-10-10
 * OpenRouter   : used only when all Groq keys are rate-limited
 */

const GROQ_MODEL = "qwen/qwen3.8-27b";
const OPENROUTER_MODEL = "qwen/qwen-2.5-7b-instruct";
const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";

/** Round-robin cursor (module-level singleton per process). */
let _groqKeyIndex = 0;

/**
 * Call the LLM with automatic key rotation and provider fallback.
 *
 * @param {{ groq: string[]; openrouter: string[] }} keys
 * @param {string} prompt
 * @param {{ maxTokens?: number }} [options]
 * @returns {Promise<{ text: string; provider: string; model: string }>}
 */
export async function callLlm(keys, prompt, { maxTokens = 512 } = {}) {
  const groqKeys = keys.groq ?? [];
  const orKeys = keys.openrouter ?? [];

  // Try each Groq key in round-robin order.
  for (let attempt = 0; attempt < groqKeys.length; attempt += 1) {
    const index = (_groqKeyIndex + attempt) % groqKeys.length;
    const key = groqKeys[index];
    try {
      const text = await _chat(GROQ_BASE, key, GROQ_MODEL, prompt, maxTokens);
      _groqKeyIndex = (index + 1) % groqKeys.length;
      return { text, provider: "groq", model: GROQ_MODEL };
    } catch (error) {
      if (!_isRateLimitError(error)) throw error;
    }
  }

  // Fall back to OpenRouter if any key is configured.
  for (const key of orKeys) {
    try {
      const text = await _chat(
        OPENROUTER_BASE,
        key,
        OPENROUTER_MODEL,
        prompt,
        maxTokens,
      );
      return { text, provider: "openrouter", model: OPENROUTER_MODEL };
    } catch {
      // Try next OpenRouter key.
    }
  }

  throw new Error(
    "All configured LLM providers are rate-limited or unavailable",
  );
}

export function resolvedLlmKeys(environment) {
  const split = (name) =>
    (environment[name] ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  return {
    groq: split("GROQ_API_KEYS"),
    openrouter: split("OPENROUTER_API_KEYS"),
  };
}

function _isRateLimitError(error) {
  return (
    error.message.includes("429") ||
    error.message.toLowerCase().includes("rate limit") ||
    error.message.toLowerCase().includes("rate_limit")
  );
}

async function _chat(baseUrl, key, model, prompt, maxTokens) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `LLM HTTP ${response.status}: ${body.error?.message ?? JSON.stringify(body.error)}`,
    );
  }
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("LLM response has no content");
  return text;
}
