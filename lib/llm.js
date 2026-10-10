/**
 * LLM client: Groq keys first (round-robin), then OpenRouter keys.
 *
 * Any failure on one key (rate limit, 5xx, timeout, revoked key) moves on to
 * the next key, then the next provider, so spare keys are real redundancy.
 * Key values are never logged.
 *
 * Measured 2026-10-10: 348 reviews tagged on Groq in about 70 minutes, peak
 * 25 per minute, OpenRouter never needed. Daily load is about 10 to 30 calls.
 *
 * Groq model   : qwen/qwen3.8-27b, verified 2026-10-10
 */

const GROQ_MODEL = "qwen/qwen3.8-27b";
const OPENROUTER_MODEL = "qwen/qwen-2.5-7b-instruct";
const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";

/** Round-robin cursor (module-level singleton per process). */
let _groqKeyIndex = 0;

/**
 * Call the LLM with key rotation and provider fallback.
 *
 * @param {{ groq: string[]; openrouter: string[] }} keys
 * @param {string} prompt
 * @param {{ maxTokens?: number; chat?: typeof _chat }} [options]
 * @returns {Promise<{ text: string; provider: string; model: string }>}
 */
export async function callLlm(keys, prompt, { maxTokens = 512, chat = _chat } = {}) {
  const groqKeys = keys.groq ?? [];
  const orKeys = keys.openrouter ?? [];
  const failures = [];

  for (let attempt = 0; attempt < groqKeys.length; attempt += 1) {
    const index = (_groqKeyIndex + attempt) % groqKeys.length;
    try {
      const text = await chat(GROQ_BASE, groqKeys[index], GROQ_MODEL, prompt, maxTokens);
      _groqKeyIndex = (index + 1) % groqKeys.length;
      return { text, provider: "groq", model: GROQ_MODEL };
    } catch (error) {
      failures.push(`groq key ${index + 1}: ${_reason(error)}`);
    }
  }

  for (let index = 0; index < orKeys.length; index += 1) {
    try {
      const text = await chat(OPENROUTER_BASE, orKeys[index], OPENROUTER_MODEL, prompt, maxTokens);
      return { text, provider: "openrouter", model: OPENROUTER_MODEL };
    } catch (error) {
      failures.push(`openrouter key ${index + 1}: ${_reason(error)}`);
    }
  }

  // "rate-limited" keeps the review pending without using up an attempt
  // (see lib/enrich-runner.js): the review itself is not at fault.
  throw new Error(
    `All configured LLM providers are rate-limited or unavailable (${failures.join("; ") || "no keys"})`,
  );
}

/** Short failure reason without any key material. */
function _reason(error) {
  const message = String(error?.message ?? error);
  const status = message.match(/HTTP (\d{3})/)?.[1];
  if (status) return `HTTP ${status}`;
  if (/timeout|aborted/i.test(message)) return "timeout";
  return message.slice(0, 60);
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
