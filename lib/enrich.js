/**
 * Review enrichment: sentiment score + topic tagging via LLM.
 *
 * Output shape stored in review_enrichment + review_topics:
 *   sentiment_score : float 0–1  (1 = very positive)
 *   topics          : [{ topic, polarity, severity, evidence }]
 *
 * Valid topics (from dashboard.config.js):
 *   cleanliness, check_in, staff, noise, facilities, location,
 *   room_condition, value_for_money, other
 *
 * PROMPT_VERSION_KEY is a stable content-hash of the prompt template so
 * a changed prompt automatically triggers re-enrichment on the next run.
 */

import { createHash } from "node:crypto";
import { topics as validTopics } from "../dashboard.config.js";

// ── Prompt ────────────────────────────────────────────────────────────────

/**
 * Build the static prompt template string.
 * Defined first so PROMPT_VERSION_KEY can reference it safely.
 * @returns {string}
 */
function buildPromptTemplate() {
  return `You are a hotel-review analyst. Given the review text below, output ONLY valid JSON with this exact structure:

{
  "sentiment_score": <float 0.00–1.00, where 0=very negative, 0.5=neutral, 1=very positive>,
  "topics": [
    {
      "topic": <one of: ${validTopics.join(", ")}>,
      "polarity": <"positive" or "negative">,
      "severity": <integer 1–3, where 1=minor mention, 2=clear issue/praise, 3=strong emphasis>,
      "evidence": <verbatim quote ≤120 chars from the review>
    }
  ]
}

Rules:
- Include ONLY topics explicitly mentioned in the review.
- Do NOT invent or hallucinate topics.
- If NO topic applies, topics must be an empty array [].
- Emit at most one entry per (topic, polarity) pair.
- Output ONLY the JSON object. No markdown, no explanation.

REVIEW:
Title: {{title}}
Liked: {{liked}}
Disliked: {{disliked}}`;
}

const _TEMPLATE = buildPromptTemplate();

export const PROMPT_VERSION = "v1";

/** Stable 8-char content hash of the prompt template. */
const _templateHash = createHash("sha256")
  .update(_TEMPLATE)
  .digest("hex")
  .slice(0, 8);

/** Stored in review_enrichment.prompt_version — changes on prompt edits. */
export const PROMPT_VERSION_KEY = `${PROMPT_VERSION}-${_templateHash}`;

// ── Public helpers ────────────────────────────────────────────────────────

/**
 * Build the full prompt for a review.
 * @param {{ title?: string|null; likedText?: string|null; dislikedText?: string|null }} review
 * @returns {string}
 */
export function buildPrompt(review) {
  return _TEMPLATE
    .replace("{{title}}", review.title ?? "")
    .replace("{{liked}}", review.likedText ?? "")
    .replace("{{disliked}}", review.dislikedText ?? "");
}

/**
 * Parse and validate the raw LLM JSON response.
 * Returns null when the output is unparseable or structurally invalid
 * so the caller can record the failure rather than throw.
 *
 * @param {string} text
 * @returns {{ sentimentScore: number; topics: object[] } | null}
 */
export function parseEnrichmentResponse(text) {
  try {
    // Strip <think>...</think> blocks (some models include chain-of-thought).
    const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Strip optional markdown code fences.
    const cleaned = withoutThink
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    // Extract the first JSON object.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);

    const sentimentScore = Number(parsed.sentiment_score);
    if (!Number.isFinite(sentimentScore) || sentimentScore < 0 || sentimentScore > 1)
      return null;

    if (!Array.isArray(parsed.topics)) return null;

    const topics = [];
    for (const t of parsed.topics) {
      const topic = String(t.topic ?? "");
      const polarity = String(t.polarity ?? "");
      const severity = Number(t.severity);
      const evidence = String(t.evidence ?? "").slice(0, 120);

      if (!validTopics.includes(topic)) continue;
      if (!["positive", "negative"].includes(polarity)) continue;
      if (![1, 2, 3].includes(severity)) continue;
      if (!evidence) continue;

      topics.push({ topic, polarity, severity, evidence });
    }

    return { sentimentScore, topics };
  } catch {
    return null;
  }
}

/**
 * Enrich a single review via LLM.
 * Throws if the LLM returns an unparseable response.
 *
 * @param {{ title?: string|null; likedText?: string|null; dislikedText?: string|null }} review
 * @param {(prompt: string, options?: { maxTokens?: number }) => Promise<{ text: string; provider: string; model: string }>} callLlmFn
 * @returns {Promise<{ sentimentScore: number; topics: object[]; provider: string; model: string }>}
 */
export async function enrichReview(review, callLlmFn) {
  const prompt = buildPrompt(review);
  const { text, provider, model } = await callLlmFn(prompt, { maxTokens: 1024 });
  const result = parseEnrichmentResponse(text);
  if (!result) {
    throw new Error(`LLM returned unparseable output: ${text.slice(0, 200)}`);
  }
  const { kept, dropped } = filterByEvidence(result.topics, review);
  return { ...result, topics: kept, droppedTags: dropped, provider, model };
}

const squash = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s"'‘’“”.,!?;:]+/g, " ")
    .trim();

/**
 * Keep only tags whose evidence quote really appears in the review
 * (case, whitespace and punctuation insensitive). This blocks invented tags.
 *
 * @param {Array<{ evidence: string }>} topics
 * @param {{ title?: string|null; likedText?: string|null; dislikedText?: string|null }} review
 */
export function filterByEvidence(topics, review) {
  const haystack = squash(
    [review.title, review.likedText, review.dislikedText].join(" | "),
  );
  const kept = [];
  let dropped = 0;
  for (const tag of topics) {
    const needle = squash(tag.evidence);
    if (needle && haystack.includes(needle)) kept.push(tag);
    else dropped += 1;
  }
  return { kept, dropped };
}
