/**
 * Dashboard analytics as pure functions over canonical reviews.
 *
 * Every number on the dashboard comes from here, so it can be tested
 * without a database. Data sources (`lib/repository.js`) only load reviews.
 *
 * Canonical review shape:
 * @typedef {{ topic: string; polarity: "positive"|"negative"; severity: number; evidence: string }} Tag
 * @typedef {{
 *   id: string; propertyId: string; rating: number; reviewDate: string;
 *   title: string|null; liked: string|null; disliked: string|null;
 *   stayDate: string|null; country: string|null; travellerType: string|null;
 *   roomName: string|null; nights: number|null; reply: string|null;
 *   reviewUrl: string|null; ratingPrecision: string;
 *   enrichmentStatus: string; sentiment: number|null; topics: Tag[];
 *   localDate?: string;
 * }} Review
 */

import {
  attentionRules,
  lowVolume,
  properties,
  thresholds,
  timezone,
  topicLabels,
  topics as topicIds,
  trendWeeks,
} from "../dashboard.config.js";
import { addDays, localDate, weekStart } from "./weeks.js";

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const pct = (part, whole) => (whole ? part / whole : null);
const propertyName = (id) => properties.find((p) => p.id === id)?.name ?? id;

/** @param {number} rating @returns {"positive"|"neutral"|"negative"} */
export function ratingBand(rating) {
  if (rating < thresholds.negative) return "negative";
  if (rating >= thresholds.positive) return "positive";
  return "neutral";
}

/** Attach the Sydney calendar date once, so filters never re-parse. */
export function withLocalDates(reviews) {
  return reviews.map((r) =>
    r.localDate ? r : { ...r, localDate: localDate(r.reviewDate, timezone) },
  );
}

/** @param {Review[]} reviews @param {{from: string; to: string}} range */
export function inRange(reviews, { from, to }) {
  return reviews.filter((r) => r.localDate >= from && r.localDate <= to);
}

/** Rating statistics for a set of reviews. */
export function stats(reviews) {
  const count = reviews.length;
  let sum = 0;
  const bands = { positive: 0, neutral: 0, negative: 0 };
  for (const r of reviews) {
    sum += r.rating;
    bands[ratingBand(r.rating)] += 1;
  }
  return {
    count,
    average: count ? round2(sum / count) : null,
    ...bands,
    positiveShare: pct(bands.positive, count),
    negativeShare: pct(bands.negative, count),
    lowVolume: count < lowVolume,
  };
}

function difference(current, previous) {
  return current == null || previous == null ? null : round2(current - previous);
}

/** Topic metrics, both shares from the methodology doc. */
export function topicStats(reviews) {
  const total = reviews.length;
  const negativeReviews = reviews.filter((r) => ratingBand(r.rating) === "negative");
  return topicIds.map((topic) => {
    const has = (r, polarity) =>
      r.topics.some((t) => t.topic === topic && t.polarity === polarity);
    const complaints = reviews.filter((r) => has(r, "negative")).length;
    const praise = reviews.filter((r) => has(r, "positive")).length;
    const inNegative = negativeReviews.filter((r) => has(r, "negative")).length;
    const severe = reviews.filter((r) =>
      r.topics.some((t) => t.topic === topic && t.polarity === "negative" && t.severity >= 3),
    ).length;
    return {
      topic,
      label: topicLabels[topic] ?? topic,
      complaints,
      praise,
      reviews: total,
      complaintShare: pct(complaints, total),
      praiseShare: pct(praise, total),
      negativeReviews: negativeReviews.length,
      negativeMentioning: inNegative,
      shareOfNegative: pct(inNegative, negativeReviews.length),
      severe,
    };
  });
}

/** Weekly series for the trend chart, oldest first. */
export function weeklyTrend(reviews, endDate, weeks = trendWeeks) {
  const lastWeek = weekStart(endDate);
  const series = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(lastWeek, -7 * i);
    const end = addDays(start, 6);
    const s = stats(inRange(reviews, { from: start, to: end }));
    series.push({
      weekStart: start,
      weekEnd: end,
      count: s.count,
      positive: s.positive,
      neutral: s.neutral,
      negative: s.negative,
      average: s.average,
    });
  }
  return series;
}

function periodWord(periods, today) {
  const thisWeek = weekStart(today);
  const { from, to } = periods.current;
  if (from === thisWeek && to >= today) return "this week";
  if (from === addDays(thisWeek, -7) && to === addDays(thisWeek, -1))
    return "last week";
  return "in this period";
}

function signedPoints(delta) {
  const abs = Math.abs(delta).toFixed(1);
  return `${delta > 0 ? "up" : "down"} ${abs} point${abs === "1.0" ? "" : "s"}`;
}

const fmtPct = (share) => `${Math.round(share * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Plain-language sentences for the insights strip.
 * Every percentage carries its counts so staff can judge the sample.
 */
export function buildInsights({ summary, topics, propertyRows, periods, today, propertyFilter }) {
  const out = [];
  const when = periodWord(periods, today);
  const before = { "this week": "last week", "last week": "the week before" }[when] ?? "the previous period";
  const cur = summary.current;
  const prev = summary.previous;

  if (!cur.count) {
    out.push({ tone: "neutral", text: `No reviews were published ${when}.` });
  } else {
    let text = `Average rating ${when} is ${cur.average.toFixed(1)} out of 10 from ${plural(cur.count, "review")}`;
    if (prev.count && summary.delta.average != null) {
      text +=
        Math.abs(summary.delta.average) < 0.05
          ? `, level with ${before} (${prev.average.toFixed(1)}).`
          : `, ${signedPoints(summary.delta.average)} on ${before} (${prev.average.toFixed(1)} from ${plural(prev.count, "review")}).`;
    } else {
      text += `. There were no reviews ${before} to compare with.`;
    }
    if (cur.lowVolume) text += " Few reviews, so treat the change with care.";
    const tone = summary.delta.average == null ? "neutral" : summary.delta.average <= -0.3 ? "negative" : summary.delta.average >= 0.3 ? "positive" : "neutral";
    out.push({ tone, text });
  }

  const ranked = topics.filter((t) => t.topic !== "other");
  const byNegative = [...ranked].sort((a, b) => b.negativeMentioning - a.negativeMentioning)[0];
  const negativeSentence = cur.negative > 0 && byNegative?.negativeMentioning > 0;
  if (negativeSentence) {
    const topic = byNegative.label.toLowerCase();
    out.push({
      tone: "negative",
      // A percentage of one or two reviews overstates the signal, so say the counts.
      text:
        cur.negative >= 3
          ? `${fmtPct(byNegative.shareOfNegative)} of negative reviews ${when} mentioned ${topic} issues (${byNegative.negativeMentioning} of ${cur.negative}).`
          : cur.negative === 1
            ? `The only negative review ${when} mentioned ${topic} issues.`
            : `${byNegative.negativeMentioning} of the ${cur.negative} negative reviews ${when} mentioned ${topic} issues.`,
    });
  }
  const topComplaint = [...ranked].sort((a, b) => b.complaints - a.complaints)[0];
  if (topComplaint?.complaints > 0 && (!negativeSentence || topComplaint.topic !== byNegative.topic)) {
    out.push({
      tone: "negative",
      text: `${topComplaint.label} was the most common complaint ${when}, raised in ${topComplaint.complaints} of ${cur.count} reviews (${fmtPct(topComplaint.complaintShare)}).`,
    });
  }

  const rising = ranked
    .filter((t) => t.change != null && t.change >= 0.05 && t.complaints >= 3)
    .sort((a, b) => b.change - a.change)[0];
  if (rising) {
    out.push({
      tone: "negative",
      text: `${rising.label} complaints rose from ${fmtPct(rising.previousComplaintShare)} to ${fmtPct(rising.complaintShare)} of reviews (${rising.complaints} of ${cur.count}).`,
    });
  }

  if (!propertyFilter) {
    const movers = propertyRows
      .filter((p) => p.delta.average != null && !p.current.lowVolume && !p.previous.lowVolume)
      .sort((a, b) => Math.abs(b.delta.average) - Math.abs(a.delta.average));
    const mover = movers[0];
    if (mover && Math.abs(mover.delta.average) >= 0.3) {
      out.push({
        tone: mover.delta.average < 0 ? "negative" : "positive",
        text: `${mover.name} ${mover.delta.average < 0 ? "fell" : "rose"} ${Math.abs(mover.delta.average).toFixed(1)} points, from ${mover.previous.average.toFixed(1)} to ${mover.current.average.toFixed(1)} (${plural(mover.current.count, "review")}).`,
      });
    }
  }

  const praised = [...ranked].sort((a, b) => b.praise - a.praise)[0];
  if (praised?.praise > 0) {
    out.push({
      tone: "positive",
      text: `Guests most often praised ${praised.label.toLowerCase()} (${praised.praise} of ${cur.count} reviews, ${fmtPct(praised.praiseShare)}).`,
    });
  }
  return out.slice(0, 5);
}

/** Needs-attention flags. Each has a plain reason and the counts behind it. */
export function buildAttention({ reviews, propertyRows, topics, today, propertyFilter }) {
  const flags = [];
  const rules = attentionRules;

  for (const p of propertyRows) {
    if (propertyFilter && p.id !== propertyFilter) continue;
    if (
      p.delta.average != null &&
      p.delta.average <= -rules.propertyDrop.points &&
      p.current.count >= rules.propertyDrop.minReviews &&
      p.previous.count >= rules.propertyDrop.minReviews
    ) {
      flags.push({
        level: "warning",
        title: `${p.name}: rating dropped`,
        detail: `Average fell ${Math.abs(p.delta.average).toFixed(1)} points to ${p.current.average.toFixed(1)} (${p.current.count} reviews, previously ${p.previous.average.toFixed(1)} from ${p.previous.count}).`,
      });
    }
  }

  for (const t of topics) {
    if (t.topic === "other" || t.change == null) continue;
    if (t.change * 100 >= rules.topicRise.percentagePoints && t.complaints >= rules.topicRise.minComplaints) {
      flags.push({
        level: "warning",
        title: `${t.label} complaints are rising`,
        detail: `Now ${fmtPct(t.complaintShare)} of reviews (${t.complaints} of ${t.reviews}), up from ${fmtPct(t.previousComplaintShare)}.`,
      });
    }
  }

  const recentFrom = addDays(today, -(rules.negativeBurst.days - 1));
  const recent = inRange(reviews, { from: recentFrom, to: today }).filter(
    (r) => !propertyFilter || r.propertyId === propertyFilter,
  );
  for (const p of properties) {
    const negatives = recent.filter((r) => r.propertyId === p.id && ratingBand(r.rating) === "negative");
    if (negatives.length >= rules.negativeBurst.count) {
      flags.push({
        level: "critical",
        title: `${p.name}: ${negatives.length} negative reviews in ${rules.negativeBurst.days} days`,
        detail: `Ratings below ${thresholds.negative} since ${recentFrom}. Read them in the Reviews tab.`,
        propertyId: p.id,
      });
    }
  }

  const severe = recent.filter((r) =>
    r.topics.some((t) => t.polarity === "negative" && t.severity >= rules.severeIssue.severity),
  );
  for (const r of severe.slice(0, 3)) {
    const tag = r.topics.find((t) => t.polarity === "negative" && t.severity >= rules.severeIssue.severity);
    flags.push({
      level: "critical",
      title: `Serious ${(topicLabels[tag.topic] ?? tag.topic).toLowerCase()} issue at ${propertyName(r.propertyId)}`,
      detail: `"${tag.evidence}" (rated ${r.rating}, ${r.localDate}).`,
      reviewId: r.id,
    });
  }
  return flags;
}

/**
 * Everything the overview needs, in one payload.
 *
 * @param {{ reviews: Review[]; periods: ReturnType<typeof import("./weeks.js").resolvePeriods>; property?: string|null; today: string }} input
 */
export function buildDashboard({ reviews, periods, property = null, today }) {
  const all = withLocalDates(reviews);
  const scoped = property ? all.filter((r) => r.propertyId === property) : all;
  const current = inRange(scoped, periods.current);
  const previous = inRange(scoped, periods.previous);

  const cur = stats(current);
  const prev = stats(previous);
  const summary = {
    current: cur,
    previous: prev,
    delta: {
      average: difference(cur.average, prev.average),
      count: cur.count - prev.count,
      negativeShare: difference(cur.negativeShare, prev.negativeShare),
    },
  };

  const prevTopics = new Map(topicStats(previous).map((t) => [t.topic, t]));
  const topics = topicStats(current)
    .map((t) => {
      const p = prevTopics.get(t.topic);
      return {
        ...t,
        previousComplaints: p.complaints,
        previousComplaintShare: p.complaintShare,
        change: difference(t.complaintShare, p.complaintShare),
      };
    })
    .sort((a, b) => (a.topic === "other") - (b.topic === "other") || b.complaints - a.complaints || b.praise - a.praise);

  const propertyRows = properties.map((p) => {
    const mine = all.filter((r) => r.propertyId === p.id);
    const c = stats(inRange(mine, periods.current));
    const pr = stats(inRange(mine, periods.previous));
    return {
      id: p.id,
      name: p.name,
      bookingUrl: p.bookingUrl,
      current: c,
      previous: pr,
      delta: {
        average: difference(c.average, pr.average),
        count: c.count - pr.count,
      },
      sparkline: weeklyTrend(mine, periods.current.to).map((w) => w.average),
    };
  });

  const trend = weeklyTrend(scoped, periods.current.to);
  const top = topics.find((t) => t.topic !== "other" && t.complaints > 0) ?? null;

  return {
    periods,
    property,
    thresholds,
    lowVolume,
    summary,
    topComplaint: top && {
      topic: top.topic,
      label: top.label,
      complaints: top.complaints,
      reviews: top.reviews,
      share: top.complaintShare,
    },
    properties: propertyRows,
    trend,
    topics,
    insights: buildInsights({ summary, topics, propertyRows, periods, today, propertyFilter: property }),
    attention: buildAttention({ reviews: all, propertyRows, topics, today, propertyFilter: property }),
  };
}

/**
 * Review feed filtering, sorting and paging.
 *
 * @param {Review[]} reviews
 * @param {{ property?: string|null; from?: string|null; to?: string|null; sentiment?: string|null; topic?: string|null; polarity?: string|null; q?: string|null; sort?: string; limit?: number; offset?: number }} options
 */
export function filterFeed(reviews, options = {}) {
  const { property, from, to, sentiment, topic, polarity, q, sort = "newest" } = options;
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const needle = q?.trim().toLowerCase();

  let rows = withLocalDates(reviews).filter((r) => {
    if (property && r.propertyId !== property) return false;
    if (from && r.localDate < from) return false;
    if (to && r.localDate > to) return false;
    if (sentiment && ratingBand(r.rating) !== sentiment) return false;
    if (topic && !r.topics.some((t) => t.topic === topic && (!polarity || t.polarity === polarity))) return false;
    if (needle) {
      const hay = [r.title, r.liked, r.disliked, r.roomName, r.country].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    if (sort === "lowest") return a.rating - b.rating || b.reviewDate.localeCompare(a.reviewDate);
    if (sort === "highest") return b.rating - a.rating || b.reviewDate.localeCompare(a.reviewDate);
    if (sort === "oldest") return a.reviewDate.localeCompare(b.reviewDate);
    return b.reviewDate.localeCompare(a.reviewDate);
  });

  const total = rows.length;
  rows = rows.slice(offset, offset + limit).map((r) => ({
    ...r,
    propertyName: propertyName(r.propertyId),
    band: ratingBand(r.rating),
  }));
  return { total, offset, limit, reviews: rows };
}

export { round1 };
