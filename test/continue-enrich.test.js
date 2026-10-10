import { describe, expect, it } from "vitest";
import {
  continuationUrl,
  MAX_HOPS,
  MAX_IDLE,
  shouldContinue,
  startNextHop,
} from "../lib/continue-enrich.js";

describe("shouldContinue", () => {
  it("continues while a time-boxed pass made progress", () => {
    expect(
      shouldContinue(
        { done: 20, failed: 0, skipped: 1, stoppedEarly: true },
        0,
      ),
    ).toEqual({ next: true, idle: 0 });
  });

  it("stops when nothing is left", () => {
    expect(shouldContinue({ done: 3, stoppedEarly: false }, 4).next).toBe(
      false,
    );
  });

  it("waits out rate limits a few times, then gives up until the next cron", () => {
    const limited = { done: 0, stoppedEarly: true, rateLimited: true };
    expect(shouldContinue(limited, 2, 0)).toEqual({ next: true, idle: 1 });
    expect(shouldContinue(limited, 1, MAX_IDLE).next).toBe(false);
    // Progress after a rate limit resets the count.
    expect(
      shouldContinue({ done: 5, stoppedEarly: true, rateLimited: true }, 1, 2),
    ).toEqual({ next: true, idle: 0 });
  });

  it("hands on when the cron's collection used the whole time budget", () => {
    expect(shouldContinue({ done: 0, stoppedEarly: true, outOfTime: true }, 0)).toEqual({ next: true, idle: 1 });
  });

  it("stops when no progress for any other reason, so failing keys cannot loop", () => {
    expect(shouldContinue({ done: 0, stoppedEarly: true }, 2).next).toBe(false);
  });

  it("stops on an error or at the hop limit", () => {
    expect(shouldContinue({ error: "db down" }, 0).next).toBe(false);
    expect(
      shouldContinue({ done: 25, stoppedEarly: true }, MAX_HOPS).next,
    ).toBe(false);
  });
});

describe("startNextHop", () => {
  it("only targets the project's own production domain", () => {
    expect(
      continuationUrl({
        VERCEL_PROJECT_PRODUCTION_URL: "booking-kpi.vercel.app",
      }),
    ).toBe("https://booking-kpi.vercel.app/api/enrich");
    expect(continuationUrl({})).toBeNull();
  });

  it("does nothing off Vercel", async () => {
    const result = await startNextHop({ CRON_SECRET: "s" }, 1, 0, () => {
      throw new Error("should not be called");
    });
    expect(result.started).toBe(false);
  });

  it("sends the secret and hop number, and reports acceptance", async () => {
    let seen;
    const result = await startNextHop(
      { VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app", CRON_SECRET: "s" },
      3,
      1,
      async (url, init) => {
        seen = { url, init };
        return { status: 202 };
      },
    );
    expect(result).toEqual({ started: true, hop: 3 });
    expect(seen.init.headers).toEqual({
      authorization: "Bearer s",
      "x-enrich-hop": "3",
      "x-enrich-idle": "1",
    });
  });

  it("reports a refused hand-off instead of throwing", async () => {
    const env = {
      VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app",
      CRON_SECRET: "s",
    };
    expect(
      (await startNextHop(env, 1, 0, async () => ({ status: 401 }))).started,
    ).toBe(false);
    expect(
      (
        await startNextHop(env, 1, 0, async () => {
          throw new Error("timeout");
        })
      ).started,
    ).toBe(false);
  });
});
