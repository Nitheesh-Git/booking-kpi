import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  parseEnrichmentResponse,
  enrichReview,
  PROMPT_VERSION_KEY,
} from "../lib/enrich.js";

describe("buildPrompt", () => {
  it("includes all review text fields in the prompt", () => {
    const prompt = buildPrompt({
      title: "Great location",
      likedText: "Near the station",
      dislikedText: "Noisy at night",
    });
    expect(prompt).toContain("Great location");
    expect(prompt).toContain("Near the station");
    expect(prompt).toContain("Noisy at night");
  });

  it("handles null fields gracefully without throwing", () => {
    const prompt = buildPrompt({ title: null, likedText: null, dislikedText: null });
    expect(prompt).toContain("Title:");
    expect(prompt).toContain("Liked:");
    expect(prompt).toContain("Disliked:");
  });
});

describe("PROMPT_VERSION_KEY", () => {
  it("is a non-empty string starting with v1-", () => {
    expect(typeof PROMPT_VERSION_KEY).toBe("string");
    expect(PROMPT_VERSION_KEY).toMatch(/^v1-[0-9a-f]{8}$/);
  });
});

describe("parseEnrichmentResponse", () => {
  it("parses a valid clean response", () => {
    const text = JSON.stringify({
      sentiment_score: 0.75,
      topics: [
        {
          topic: "location",
          polarity: "positive",
          severity: 2,
          evidence: "Near the station",
        },
      ],
    });
    const result = parseEnrichmentResponse(text);
    expect(result).not.toBeNull();
    expect(result.sentimentScore).toBe(0.75);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].topic).toBe("location");
    expect(result.topics[0].polarity).toBe("positive");
    expect(result.topics[0].severity).toBe(2);
  });

  it("strips markdown code fences", () => {
    const text = "```json\n{\"sentiment_score\":0.5,\"topics\":[]}\n```";
    const result = parseEnrichmentResponse(text);
    expect(result).not.toBeNull();
    expect(result.sentimentScore).toBe(0.5);
  });

  it("strips <think>...</think> chain-of-thought blocks", () => {
    const text =
      "<think>Let me analyse this carefully.</think>\n{\"sentiment_score\":0.3,\"topics\":[]}";
    const result = parseEnrichmentResponse(text);
    expect(result).not.toBeNull();
    expect(result.sentimentScore).toBe(0.3);
  });

  it("discards topics with unknown topic names", () => {
    const text = JSON.stringify({
      sentiment_score: 0.5,
      topics: [
        { topic: "unknown_xyz", polarity: "positive", severity: 1, evidence: "x" },
        { topic: "cleanliness", polarity: "negative", severity: 2, evidence: "dirty" },
      ],
    });
    const result = parseEnrichmentResponse(text);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].topic).toBe("cleanliness");
  });

  it("discards entries with invalid polarity", () => {
    const text = JSON.stringify({
      sentiment_score: 0.6,
      topics: [{ topic: "staff", polarity: "neutral", severity: 1, evidence: "staff" }],
    });
    const result = parseEnrichmentResponse(text);
    expect(result.topics).toHaveLength(0);
  });

  it("discards entries with severity outside 1–3", () => {
    const text = JSON.stringify({
      sentiment_score: 0.6,
      topics: [{ topic: "noise", polarity: "negative", severity: 5, evidence: "loud" }],
    });
    const result = parseEnrichmentResponse(text);
    expect(result.topics).toHaveLength(0);
  });

  it("truncates evidence to 120 chars", () => {
    const longEvidence = "a".repeat(200);
    const text = JSON.stringify({
      sentiment_score: 0.5,
      topics: [
        {
          topic: "cleanliness",
          polarity: "positive",
          severity: 1,
          evidence: longEvidence,
        },
      ],
    });
    const result = parseEnrichmentResponse(text);
    expect(result.topics[0].evidence).toHaveLength(120);
  });

  it("returns null for invalid JSON", () => {
    expect(parseEnrichmentResponse("not json at all")).toBeNull();
  });

  it("returns null when sentiment_score is above 1", () => {
    const text = JSON.stringify({ sentiment_score: 1.5, topics: [] });
    expect(parseEnrichmentResponse(text)).toBeNull();
  });

  it("returns null when sentiment_score is missing", () => {
    const text = JSON.stringify({ topics: [] });
    expect(parseEnrichmentResponse(text)).toBeNull();
  });

  it("accepts a valid empty topics array", () => {
    const text = JSON.stringify({ sentiment_score: 0.5, topics: [] });
    const result = parseEnrichmentResponse(text);
    expect(result).not.toBeNull();
    expect(result.topics).toHaveLength(0);
  });

  it("handles all valid topic names", () => {
    const validTopics = [
      "cleanliness", "check_in", "staff", "noise",
      "facilities", "location", "room_condition", "value_for_money", "other",
    ];
    for (const topic of validTopics) {
      const text = JSON.stringify({
        sentiment_score: 0.5,
        topics: [{ topic, polarity: "positive", severity: 1, evidence: "test" }],
      });
      const result = parseEnrichmentResponse(text);
      expect(result.topics[0].topic).toBe(topic);
    }
  });
});

describe("enrichReview", () => {
  it("calls the LLM and returns structured data", async () => {
    const mockResponse = JSON.stringify({
      sentiment_score: 0.8,
      topics: [
        {
          topic: "staff",
          polarity: "positive",
          severity: 2,
          evidence: "Very helpful staff",
        },
      ],
    });
    const mockLlm = async () => ({
      text: mockResponse,
      provider: "groq",
      model: "test-model",
    });

    const result = await enrichReview(
      { title: "Great", likedText: "Very helpful staff", dislikedText: null },
      mockLlm,
    );
    expect(result.sentimentScore).toBe(0.8);
    expect(result.provider).toBe("groq");
    expect(result.model).toBe("test-model");
    expect(result.topics[0].topic).toBe("staff");
  });

  it("throws when the LLM returns unparseable output", async () => {
    const mockLlm = async () => ({
      text: "SORRY I CANNOT COMPLY",
      provider: "groq",
      model: "test",
    });
    await expect(
      enrichReview({ title: "x", likedText: null, dislikedText: null }, mockLlm),
    ).rejects.toThrow(/unparseable/);
  });
});
