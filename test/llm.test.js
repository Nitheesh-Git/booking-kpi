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

describe("callLlm failover", () => {
  const keys = { groq: ["g1", "g2"], openrouter: ["o1"] };
  const fakeChat = (failing) => async (_base, key) => {
    if (failing[key]) throw new Error(failing[key]);
    return `ok from ${key}`;
  };

  it("moves to the next Groq key on a server error, not only on 429", async () => {
    const { callLlm } = await import("../lib/llm.js");
    const out = await callLlm(keys, "p", { chat: fakeChat({ g1: "LLM HTTP 503: down", g2: "LLM HTTP 503: down" }) });
    expect(out).toMatchObject({ provider: "openrouter", text: "ok from o1" });
  });

  it("skips a revoked key and still answers from Groq", async () => {
    const { callLlm } = await import("../lib/llm.js");
    const out = await callLlm(keys, "p", { chat: fakeChat({ g1: "LLM HTTP 401: invalid", g2: "LLM HTTP 401: invalid" }) });
    expect(out.provider).toBe("openrouter");
    const one = await callLlm({ groq: ["bad", "good"], openrouter: [] }, "p", { chat: fakeChat({ bad: "LLM HTTP 401: x" }) });
    expect(one.text).toBe("ok from good");
  });

  it("reports every failure without exposing keys, as a rate-limit style error", async () => {
    const { callLlm } = await import("../lib/llm.js");
    const all = { g1: "LLM HTTP 429: slow", g2: "The operation was aborted due to timeout", o1: "LLM HTTP 500: x" };
    await expect(callLlm(keys, "p", { chat: fakeChat(all) })).rejects.toThrow(
      /rate-limited or unavailable \(groq key \d: HTTP 429; groq key \d: timeout; openrouter key 1: HTTP 500\)/,
    );
    await callLlm(keys, "p", { chat: fakeChat(all) }).catch((e) => {
      expect(e.message).not.toMatch(/g1|g2|o1/);
    });
  });
});
