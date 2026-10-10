import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  isLocalDate,
  localDate,
  resolvePeriods,
  startOfLocalDay,
  weekStart,
} from "../lib/weeks.js";

describe("Sydney calendar helpers", () => {
  it("buckets a Sunday-night UTC instant into Monday in Sydney", () => {
    // 2026-10-04 14:30 UTC is Monday 2026-10-05 01:30 in Sydney (AEDT, +11).
    expect(localDate("2026-10-04T14:30:00Z")).toBe("2026-10-05");
    expect(weekStart(localDate("2026-10-04T14:30:00Z"))).toBe("2026-10-05");
    // One hour earlier in UTC is still Sunday 23:59 in Sydney... week before.
    expect(weekStart(localDate("2026-10-04T12:59:00Z"))).toBe("2026-09-28");
  });

  it("finds local midnight across daylight saving changes", () => {
    // AEST (+10) before 2026-10-04, AEDT (+11) after.
    expect(startOfLocalDay("2026-10-01")).toBe("2026-09-30T14:00:00.000Z");
    expect(startOfLocalDay("2026-10-05")).toBe("2026-10-04T13:00:00.000Z");
    // DST ends 2026-04-05.
    expect(startOfLocalDay("2026-04-06")).toBe("2026-04-05T14:00:00.000Z");
  });

  it("does date arithmetic without the server time zone", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-05", "2026-10-11")).toBe(7);
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2026-02-28")).toBe(true);
  });

  it("defaults to this week to date and an equal-length previous period", () => {
    const p = resolvePeriods({ today: "2026-10-10" });
    expect(p.current).toMatchObject({ from: "2026-10-05", to: "2026-10-10", days: 6, toDate: true });
    expect(p.previous).toMatchObject({ from: "2026-09-29", to: "2026-10-04", days: 6 });
  });

  it("accepts an explicit comparison period", () => {
    const p = resolvePeriods({
      from: "2026-10-05",
      to: "2026-10-10",
      compareFrom: "2026-09-28",
      compareTo: "2026-10-04",
      today: "2026-10-10",
    });
    expect(p.previous).toMatchObject({ from: "2026-09-28", to: "2026-10-04", days: 7 });
  });

  it("rejects a reversed range", () => {
    expect(() => resolvePeriods({ from: "2026-10-10", to: "2026-10-01", today: "2026-10-10" })).toThrow(RangeError);
  });
});
