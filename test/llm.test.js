import { describe, it, expect } from "vitest";
import { resolvedLlmKeys } from "../lib/llm.js";

describe("resolvedLlmKeys", () => {
  it("parses comma-separated GROQ keys", () => {
    const env = { GROQ_API_KEYS: "key1,key2,key3", OPENROUTER_API_KEYS: "" };
    const result = resolvedLlmKeys(env);
    expect(result.groq).toEqual(["key1", "key2", "key3"]);
    expect(result.openrouter).toHaveLength(0);
  });

  it("parses OpenRouter keys", () => {
    const env = { GROQ_API_KEYS: "", OPENROUTER_API_KEYS: "or-key-1" };
    const result = resolvedLlmKeys(env);
    expect(result.groq).toHaveLength(0);
    expect(result.openrouter).toEqual(["or-key-1"]);
  });

  it("handles missing env keys gracefully", () => {
    const result = resolvedLlmKeys({});
    expect(result.groq).toHaveLength(0);
    expect(result.openrouter).toHaveLength(0);
  });

  it("trims whitespace around keys", () => {
    const env = { GROQ_API_KEYS: " key1 , key2 ", OPENROUTER_API_KEYS: "" };
    const result = resolvedLlmKeys(env);
    expect(result.groq).toEqual(["key1", "key2"]);
  });

  it("filters out empty strings after trimming", () => {
    const env = { GROQ_API_KEYS: "key1,,key2,", OPENROUTER_API_KEYS: "" };
    const result = resolvedLlmKeys(env);
    expect(result.groq).toEqual(["key1", "key2"]);
  });
});
