/**
 * Azzurro Review Insights: dashboard client.
 *
 * No framework and no build step. All numbers come from /api/dashboard,
 * /api/reviews and /api/health; this file only formats and draws them.
 * Review text is untrusted, so every dynamic string goes through esc().
 */

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  today: null,
  tab: "overview",
  property: "",
  preset: "this-week",
  from: null,
  to: null,
  compareFrom: null,
  compareTo: null,
  dashboard: null,
  health: null,
  feed: { sentiment: "", topic: "", polarity: "", q: "", sort: "newest", offset: 0, items: [], total: 0 },
};

/* ---------------- Formatting ---------------- */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DAY = 86_400_000;
const toUtc = (d) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => fromUtc(toUtc(d) + n * DAY);
const weekStart = (d) => addDays(d, -((new Date(toUtc(d)).getUTCDay() + 6) % 7));
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY) + 1;

const dateFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dateYearFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });

const fmtDay = (d) => dateFmt.format(toUtc(d));
const fmtShort = (d) => shortFmt.format(toUtc(d));
const fmtYear = (d) => dateYearFmt.format(toUtc(d));
const fmtRange = (a, b) => (a === b ? fmtDay(a) : `${fmtDay(a)} to ${fmtDay(b)}`);
const fmtRating = (n) => (n == null ? "–" : Number(n).toFixed(1));
const fmtPct = (share) => (share == null ? "–" : `${Math.round(share * 100)}%`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function relativeTime(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function sydneyDate(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: state.config?.timezone ?? "Australia/Sydney" }).format(new Date(iso));
}

const icons = {
  up: '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M6 2.5l3.5 4H7v3H5v-3H2.5z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M6 9.5l3.5-4H7v-3H5v3H2.5z" fill="currentColor"/></svg>',
  flat: '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2.5" y="5" width="7" height="2" rx="1" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.5" r="1.3" fill="currentColor"/><rect x="6.9" y="7" width="2.2" height="6" rx="1.1" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="6.9" y="2.5" width="2.2" height="7" rx="1.1" fill="currentColor"/><circle cx="8" cy="12.5" r="1.3" fill="currentColor"/></svg>',
  warnTri: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2.5l8 14.5H2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><rect x="9.1" y="7.5" width="1.8" height="5" rx="0.9" fill="currentColor"/><circle cx="10" cy="14.6" r="1.1" fill="currentColor"/></svg>',
  okCircle: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 10.3l2.6 2.6L14 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/**
 * Change indicator. Arrow, words and color together, never color alone.
 * @param {number|null} value
 * @param {{ good?: "up"|"down"|"none"; unit?: string; digits?: number; vs?: string; scale?: number }} o
 */
function deltaChip(value, { good = "up", unit = "", digits = 1, vs = "", scale = 1 } = {}) {
  const vsText = vs ? ` <span class="vs">${esc(vs)}</span>` : "";
  if (value == null) return `<span class="delta flat">${icons.flat} No comparison</span>`;
  const shown = value * scale;
  if (Math.abs(shown) < 0.5 * 10 ** -digits) return `<span class="delta flat">${icons.flat} No change${vsText}</span>`;
  const up = shown > 0;
  const cls = good === "none" ? "flat" : (up === (good === "up") ? "good" : "bad");
  const text = `${up ? "+" : "−"}${Math.abs(shown).toFixed(digits)}${unit}`;
  const words = up ? "up" : "down";
  return `<span class="delta ${cls}">${up ? icons.up : icons.down}<span class="sr-only">${words}</span> ${text}${vsText}</span>`;
}

/* ---------------- Periods ---------------- */

function presetRange(preset, today) {
  const thisWeek = weekStart(today);
  switch (preset) {
    case "this-week":
      return { from: thisWeek, to: today, compareFrom: addDays(thisWeek, -7), compareTo: addDays(thisWeek, -1) };
    case "last-week":
      return { from: addDays(thisWeek, -7), to: addDays(thisWeek, -1) };
    case "4-weeks":
      return { from: addDays(thisWeek, -21), to: today };
    case "12-weeks":
      return { from: addDays(thisWeek, -77), to: today };
    case "12-months":
      return { from: addDays(today, -364), to: today };
    default:
      return null;
  }
}

function comparisonWords() {
  if (state.preset === "this-week") return "vs last week";
  if (state.preset === "last-week") return "vs week before";
  return "vs previous period";
}

function periodWords() {
  return {
    "this-week": "This week",
    "last-week": "Last week",
    "4-weeks": "Last 4 weeks",
    "12-weeks": "Last 12 weeks",
    "12-months": "Last 12 months",
  }[state.preset] ?? "Selected period";
}

/* ---------------- URL state ---------------- */

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.tab = ["overview", "reviews", "health"].includes(p.get("tab")) ? p.get("tab") : "overview";
  state.property = p.get("property") ?? "";
  state.preset = p.get("period") ?? "this-week";
  if (state.preset === "custom") {
    state.from = p.get("from");
    state.to = p.get("to");
  }
  state.feed.topic = p.get("topic") ?? "";
  state.feed.polarity = p.get("polarity") ?? "";
  state.feed.sentiment = p.get("sentiment") ?? "";
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.tab !== "overview") p.set("tab", state.tab);
  if (state.property) p.set("property", state.property);
  if (state.preset !== "this-week") p.set("period", state.preset);
  if (state.preset === "custom") {
    p.set("from", state.from);
    p.set("to", state.to);
  }
  if (state.feed.topic) p.set("topic", state.feed.topic);
  if (state.feed.polarity) p.set("polarity", state.feed.polarity);
  if (state.feed.sentiment) p.set("sentiment", state.feed.sentiment);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

/* ---------------- Fetching ---------------- */

async function api(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const res = await fetch(`/api/${path}${qs.toString() ? `?${qs}` : ""}`);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* Non-JSON error page. */
  }
  if (!res.ok) throw new Error(body?.error ?? `The server returned ${res.status}.`);
  return body;
}

function periodParams() {
  return {
    property: state.property,
    from: state.from,
    to: state.to,
    compareFrom: state.compareFrom,
    compareTo: state.compareTo,
  };
}

/* ---------------- States ---------------- */

function skeleton(height = 120) {
  return `<div class="skeleton" style="height:${height}px" aria-hidden="true"></div>`;
}

function errorState(message, retry = "retry") {
  return `<div class="state" role="alert"><p class="state-title">This section could not load</p><p>${esc(message)}</p><button class="btn" type="button" data-action="${retry}">Try again</button></div>`;
}

function emptyState(title, text = "") {
  return `<div class="state"><p class="state-title">${esc(title)}</p>${text ? `<p>${esc(text)}</p>` : ""}</div>`;
}

/* ---------------- Overview ---------------- */

const SECTIONS = ["insights", "attention", "properties", "volumeChart", "ratingChart", "topics"];

function showOverviewLoading() {
  $("kpis").innerHTML = Array.from({ length: 4 }, () => `<div class="card kpi">${skeleton(14)}${skeleton(36)}${skeleton(12)}</div>`).join("");
  for (const id of SECTIONS) $(id).innerHTML = `<div style="padding:0 20px 20px">${skeleton(id.endsWith("Chart") ? 220 : 120)}</div>`;
}

async function loadOverview() {
  showOverviewLoading();
  try {
    state.dashboard = await api("dashboard", periodParams());
    renderOverview();
  } catch (error) {
    $("kpis").innerHTML = `<div class="card" style="grid-column:1/-1">${errorState(error.message)}</div>`;
    for (const id of SECTIONS) $(id).innerHTML = "";
  }
}

function renderOverview() {
  const d = state.dashboard;
  const name = state.property ? state.config.properties.find((p) => p.id === state.property)?.name : "All properties";
  $("overviewTitle").textContent = name;
  $("overviewSub").textContent = `${periodWords()}: ${fmtRange(d.periods.current.from, d.periods.current.to)}${d.periods.current.toDate ? " (to date)" : ""}.`;
  renderKpis(d);
  renderInsights(d);
  renderAttention(d);
  renderProperties(d);
  renderVolumeChart(d);
  renderRatingChart(d);
  renderTopics(d);
}

function renderKpis(d) {
  const cur = d.summary.current;
  const prev = d.summary.previous;
  const vs = comparisonWords();
  const few = cur.lowVolume ? `<span class="badge" title="Fewer than ${d.lowVolume} reviews. Small samples swing a lot.">Few reviews</span>` : "";
  const total = cur.count || 1;
  const prevText = prev.count ? `${fmtRating(prev.average)} from ${plural(prev.count, "review")}` : "no reviews";
  const top = d.topComplaint;

  $("kpis").innerHTML = `
    <article class="card kpi" aria-label="Average rating">
      <div class="kpi-label"><span>Average rating</span>${few}</div>
      <div class="kpi-value num">${cur.count ? `${fmtRating(cur.average)}<small>/ 10</small>` : '<span class="muted" style="font-size:22px">No reviews</span>'}</div>
      ${deltaChip(d.summary.delta.average, { good: "up", unit: " pts", vs })}
      <div class="kpi-meta">From ${plural(cur.count, "review")}. Comparison: ${esc(prevText)}.</div>
    </article>
    <article class="card kpi" aria-label="Reviews published">
      <div class="kpi-label"><span>Reviews published</span></div>
      <div class="kpi-value num">${cur.count}</div>
      ${deltaChip(prev.count || cur.count ? d.summary.delta.count : null, { good: "none", digits: 0, vs })}
      <div class="kpi-meta">
        <div class="band-bar" role="img" aria-label="${cur.positive} positive, ${cur.neutral} neutral, ${cur.negative} negative">
          <span style="width:${(cur.positive / total) * 100}%;background:var(--series-positive)"></span>
          <span style="width:${(cur.neutral / total) * 100}%;background:var(--series-neutral)"></span>
          <span style="width:${(cur.negative / total) * 100}%;background:var(--series-negative)"></span>
        </div>
        <div class="legend-inline" style="margin-top:6px">
          <span><i class="swatch" style="background:var(--series-positive)"></i>${cur.positive} positive</span>
          <span><i class="swatch" style="background:var(--series-neutral)"></i>${cur.neutral} neutral</span>
          <span><i class="swatch" style="background:var(--series-negative)"></i>${cur.negative} negative</span>
        </div>
      </div>
    </article>
    <article class="card kpi" aria-label="Negative reviews">
      <div class="kpi-label"><span>Negative reviews</span></div>
      <div class="kpi-value num">${fmtPct(cur.negativeShare)}</div>
      ${deltaChip(d.summary.delta.negativeShare, { good: "down", unit: " pts", digits: 0, scale: 100, vs })}
      <div class="kpi-meta">${cur.negative} of ${plural(cur.count, "review")} rated below ${d.thresholds.negative} out of 10.</div>
    </article>
    <article class="card kpi" aria-label="Top complaint">
      <div class="kpi-label"><span>Top complaint</span></div>
      ${top
        ? `<div class="kpi-value text">${esc(top.label)}</div>
           <div class="kpi-meta">Raised in ${top.complaints} of ${plural(top.reviews, "review")} (${fmtPct(top.share)}).</div>
           <button class="kpi-link" type="button" data-topic="${esc(top.topic)}" data-polarity="negative">Read these reviews →</button>`
        : `<div class="kpi-value text muted">None</div><div class="kpi-meta">No complaints were found in this period's reviews.</div>`}
    </article>`;
}

function renderInsights(d) {
  if (!d.insights.length) {
    $("insights").innerHTML = emptyState("Nothing to report", "There is not enough data in this period.");
    return;
  }
  const icon = { positive: icons.check, negative: icons.alert, neutral: icons.info };
  $("insights").innerHTML = `<ul class="insight-list">${d.insights
    .map((i) => `<li class="insight tone-${esc(i.tone)}"><span class="insight-icon">${icon[i.tone] ?? icons.info}</span><span>${esc(i.text)}</span></li>`)
    .join("")}</ul>`;
}

function renderAttention(d) {
  if (!d.attention.length) {
    $("attention").innerHTML = `<div class="all-clear">${icons.okCircle}<span>Nothing needs attention. No big rating drops, rising complaints or serious issues in the last 7 days.</span></div>`;
    return;
  }
  $("attention").innerHTML = `<ul class="flag-list">${d.attention
    .map(
      (f) => `<li class="flag ${esc(f.level)}"><span class="flag-icon">${icons.warnTri}</span><div>
        <div class="flag-title"><span class="sr-only">${f.level === "critical" ? "Urgent: " : "Warning: "}</span>${esc(f.title)}</div>
        <div class="flag-detail">${esc(f.detail)}</div></div></li>`,
    )
    .join("")}</ul>`;
}

function sparkline(values, lo, hi) {
  const w = 96;
  const h = 28;
  const pts = values.map((v, i) => (v == null ? null : [2 + (i * (w - 4)) / (values.length - 1), 3 + (h - 6) * (1 - (v - lo) / (hi - lo || 1))]));
  let path = "";
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    path += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  const last = [...pts].reverse().find(Boolean);
  const known = values.filter((v) => v != null);
  const label = known.length ? `Weekly average from ${fmtRating(known[0])} to ${fmtRating(known.at(-1))}` : "No reviews in the last 12 weeks";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
    <path d="${path}" fill="none" stroke="var(--series-line)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="2.75" fill="var(--series-line)" stroke="var(--surface)" stroke-width="1.5"/>` : ""}
  </svg>`;
}

function renderProperties(d) {
  const vs = comparisonWords();
  const all = d.properties.flatMap((p) => p.sparkline).filter((v) => v != null);
  const lo = all.length ? Math.max(0, Math.floor(Math.min(...all) - 0.5)) : 0;
  const hi = 10;
  const rows = d.properties
    .map((p) => {
      const sel = state.property === p.id;
      const few = p.current.lowVolume ? ` <span class="badge" title="Fewer than ${d.lowVolume} reviews">Few reviews</span>` : "";
      return `<tr class="clickable${sel ? " selected" : ""}" data-property="${esc(p.id)}" tabindex="0" aria-selected="${sel}">
        <td><div class="prop-name">${esc(p.name)}</div><div class="prop-sub"><a href="${esc(p.bookingUrl)}" target="_blank" rel="noopener" data-stop>Booking.com page ↗</a></div></td>
        <td class="r"><div class="rating-cell"><span class="rating-big num">${fmtRating(p.current.average)}</span></div></td>
        <td>${deltaChip(p.delta.average, { good: "up", unit: " pts" })}</td>
        <td class="r num">${p.current.count}${few}<div class="prop-sub">previous ${p.previous.count}</div></td>
        <td class="r num hide-sm">${fmtPct(p.current.negativeShare)}<div class="prop-sub">${p.current.negative} of ${p.current.count}</div></td>
        <td class="hide-sm">${sparkline(p.sparkline, lo, hi)}</td>
      </tr>`;
    })
    .join("");
  const t = d.summary;
  const foot = state.property
    ? ""
    : `<tfoot><tr><td><div class="prop-name">All properties</div></td>
        <td class="r"><span class="rating-big num">${fmtRating(t.current.average)}</span></td>
        <td>${deltaChip(t.delta.average, { good: "up", unit: " pts" })}</td>
        <td class="r num">${t.current.count}<div class="prop-sub">previous ${t.previous.count}</div></td>
        <td class="r num hide-sm">${fmtPct(t.current.negativeShare)}<div class="prop-sub">${t.current.negative} of ${t.current.count}</div></td>
        <td class="hide-sm"></td></tr></tfoot>`;
  $("properties").innerHTML = `<div class="table-wrap"><table>
    <caption class="sr-only">Rating by property, ${esc(vs)}</caption>
    <thead><tr><th>Property</th><th class="r">Rating</th><th>Change <span class="hide-sm">${esc(vs)}</span></th><th class="r">Reviews</th><th class="r hide-sm">Negative</th><th class="hide-sm">Last 12 weeks</th></tr></thead>
    <tbody>${rows}</tbody>${foot}</table></div>`;
}

/* ---------------- Charts ---------------- */

const tooltip = () => $("tooltip");

function showTooltip(evt, html) {
  const tip = tooltip();
  tip.innerHTML = html;
  tip.classList.add("show");
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  tooltip().classList.remove("show");
}

function niceMax(value) {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

/** Column with a rounded data end and a square baseline. */
function columnPath(x, y, w, h, r) {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function chartFrame(container, height) {
  const width = Math.max(280, Math.floor(container.clientWidth || 520));
  return { width, height, m: { l: 34, r: 12, t: 14, b: 28 } };
}

function weekInPeriod(w, d) {
  return w.weekEnd >= d.periods.current.from && w.weekStart <= d.periods.current.to;
}

/** One continuous shaded band behind the weeks in the selected period. */
function periodBand(weeks, d, left, band, top, ph) {
  const idx = weeks.map((w, i) => (weekInPeriod(w, d) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return "";
  const x = left + idx[0] * band + 1;
  return `<rect class="hl" x="${x}" y="${top - 6}" width="${(idx.at(-1) - idx[0] + 1) * band - 2}" height="${ph + 6}" rx="4"/>`;
}

function weekTooltip(w) {
  return `<div class="tooltip-title">Week of ${esc(fmtShort(w.weekStart))}</div>
    <div class="tooltip-row"><span><i class="swatch" style="background:var(--series-positive)"></i>Positive</span><b>${w.positive}</b></div>
    <div class="tooltip-row"><span><i class="swatch" style="background:var(--series-neutral)"></i>Neutral</span><b>${w.neutral}</b></div>
    <div class="tooltip-row"><span><i class="swatch" style="background:var(--series-negative)"></i>Negative</span><b>${w.negative}</b></div>
    <div class="tooltip-row" style="margin-top:4px"><span>Average rating</span><b>${fmtRating(w.average)}</b></div>`;
}

function labelEvery(band) {
  return band >= 46 ? 1 : band >= 24 ? 2 : 3;
}

function renderVolumeChart(d) {
  const el = $("volumeChart");
  const weeks = d.trend;
  const totalAll = weeks.reduce((s, w) => s + w.count, 0);
  if (!totalAll) {
    el.innerHTML = emptyState("No reviews in the last 12 weeks");
    return;
  }
  el.innerHTML = '<div class="legend-inline" style="margin-bottom:10px"></div><div class="chart"></div><p class="chart-summary"></p>';
  const chartEl = el.querySelector(".chart");
  const { width, height, m } = chartFrame(chartEl, 230);
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const max = niceMax(Math.max(...weeks.map((w) => w.count)));
  const band = pw / weeks.length;
  const bw = Math.min(24, band * 0.62);
  const y = (v) => m.t + ph - (v / max) * ph;
  const ticks = [0, max / 2, max].filter((v, i, a) => a.indexOf(v) === i);
  const every = labelEvery(band);

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly review counts by rating band, last 12 weeks">`;
  svg += periodBand(weeks, d, m.l, band, m.t, ph);
  svg += '<g class="grid">';
  for (const t of ticks) svg += `<line x1="${m.l}" x2="${width - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" class="num">${t}</text>`;
  svg += "</g>";
  const order = [
    ["negative", "var(--series-negative)"],
    ["neutral", "var(--series-neutral)"],
    ["positive", "var(--series-positive)"],
  ];
  weeks.forEach((w, i) => {
    const x = m.l + i * band + (band - bw) / 2;
    let base = 0;
    const filled = order.filter(([k]) => w[k] > 0);
    filled.forEach(([key, color], j) => {
      const top = base + w[key];
      const y0 = y(base);
      const y1 = y(top);
      const gap = j > 0 ? 2 : 0;
      const h = y0 - y1 - gap;
      const isTop = j === filled.length - 1;
      svg += isTop
        ? `<path d="${columnPath(x, y1, bw, h, 4)}" fill="${color}"/>`
        : `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(h, 0)}" fill="${color}"/>`;
      base = top;
    });
    if (weekInPeriod(w, d) && w.count) svg += `<text x="${x + bw / 2}" y="${y(w.count) - 6}" text-anchor="middle" class="label-strong num">${w.count}</text>`;
    if (i % every === (weeks.length - 1) % every) svg += `<text x="${m.l + i * band + band / 2}" y="${height - 8}" text-anchor="middle">${esc(fmtShort(w.weekStart))}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ph}"/>`;
  });
  svg += `<line class="baseline" x1="${m.l}" x2="${width - m.r}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
  chartEl.innerHTML = svg;

  el.querySelector(".legend-inline").innerHTML = `
    <span><i class="swatch" style="background:var(--series-positive)"></i>Positive (${d.thresholds.positive}+)</span>
    <span><i class="swatch" style="background:var(--series-neutral)"></i>Neutral</span>
    <span><i class="swatch" style="background:var(--series-negative)"></i>Negative (below ${d.thresholds.negative})</span>`;

  chartEl.querySelectorAll(".hit").forEach((hit) => {
    const w = weeks[Number(hit.dataset.i)];
    hit.addEventListener("mousemove", (e) => showTooltip(e, weekTooltip(w)));
    hit.addEventListener("mouseleave", hideTooltip);
  });

  const neg = weeks.reduce((s, w) => s + w.negative, 0);
  const pos = weeks.reduce((s, w) => s + w.positive, 0);
  const last = weeks.at(-1);
  el.querySelector(".chart-summary").textContent =
    `Over 12 weeks: ${totalAll} reviews, ${pos} positive (${fmtPct(pos / totalAll)}) and ${neg} negative (${fmtPct(neg / totalAll)}). ` +
    `Week of ${fmtShort(last.weekStart)}: ${last.positive} positive, ${last.neutral} neutral, ${last.negative} negative.`;
}

function renderRatingChart(d) {
  const el = $("ratingChart");
  const weeks = d.trend;
  const known = weeks.filter((w) => w.average != null);
  if (!known.length) {
    el.innerHTML = emptyState("No ratings in the last 12 weeks");
    return;
  }
  el.innerHTML = '<div class="chart"></div><p class="chart-summary"></p>';
  const chartEl = el.querySelector(".chart");
  const { width, height, m } = chartFrame(chartEl, 254);
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const lo = Math.max(0, Math.floor(Math.min(...known.map((w) => w.average)) - 0.5));
  const hi = 10;
  const band = pw / weeks.length;
  const x = (i) => m.l + i * band + band / 2;
  const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
  const step = hi - lo > 5 ? 2 : 1;
  const every = labelEvery(band);

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly average rating, last 12 weeks">`;
  svg += periodBand(weeks, d, m.l, band, m.t, ph);
  svg += '<g class="grid">';
  for (let t = lo; t <= hi; t += step) svg += `<line x1="${m.l}" x2="${width - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" class="num">${t}</text>`;
  svg += "</g>";

  let path = "";
  let pen = false;
  weeks.forEach((w, i) => {
    if (w.average == null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(w.average).toFixed(1)}`;
    pen = true;
  });
  svg += `<path d="${path}" fill="none" stroke="var(--series-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  svg += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/>`;
  weeks.forEach((w, i) => {
    if (w.average != null) svg += `<circle cx="${x(i)}" cy="${y(w.average)}" r="4" fill="var(--series-line)" stroke="var(--surface)" stroke-width="2"/>`;
    if (i % every === (weeks.length - 1) % every) svg += `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(fmtShort(w.weekStart))}</text>`;
  });
  const lastIdx = weeks.map((w) => w.average != null).lastIndexOf(true);
  svg += `<text x="${x(lastIdx)}" y="${y(weeks[lastIdx].average) - 10}" text-anchor="middle" class="label-strong num">${fmtRating(weeks[lastIdx].average)}</text>`;
  weeks.forEach((w, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ph}"/>`;
  });
  svg += `<line class="baseline" x1="${m.l}" x2="${width - m.r}" y1="${m.t + ph}" y2="${m.t + ph}"/></svg>`;
  chartEl.innerHTML = svg;

  const cross = chartEl.querySelector(".crosshair");
  chartEl.querySelectorAll(".hit").forEach((hit) => {
    const i = Number(hit.dataset.i);
    const w = weeks[i];
    hit.addEventListener("mousemove", (e) => {
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      showTooltip(e, `<div class="tooltip-title">Week of ${esc(fmtShort(w.weekStart))}</div>
        <div class="tooltip-row"><span>Average rating</span><b>${w.average == null ? "No reviews" : fmtRating(w.average)}</b></div>
        <div class="tooltip-row"><span>Reviews</span><b>${w.count}</b></div>`);
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("visibility", "hidden");
      hideTooltip();
    });
  });

  const first = known[0];
  const lastW = known.at(-1);
  const low = known.reduce((a, b) => (b.average < a.average ? b : a));
  el.querySelector(".chart-summary").textContent =
    `Weekly average moved from ${fmtRating(first.average)} (week of ${fmtShort(first.weekStart)}) to ${fmtRating(lastW.average)} (week of ${fmtShort(lastW.weekStart)}). ` +
    `Lowest week: ${fmtRating(low.average)}, week of ${fmtShort(low.weekStart)}.`;
}

function renderTopics(d) {
  const list = d.topics.filter((t) => t.topic !== "other" || t.complaints > 0);
  if (!d.summary.current.count) {
    $("topics").innerHTML = emptyState("No reviews in this period", "Choose a longer period to see topics.");
    return;
  }
  const max = Math.max(...list.map((t) => t.complaintShare ?? 0), 0.0001);
  const vs = comparisonWords();
  $("topics").innerHTML = `
    <div class="topic-head"><span>Topic</span><span>Share of reviews with a complaint</span><span></span><span>Change</span><span>Praised in</span></div>
    ${list
      .map(
        (t) => `<button class="topic-row" type="button" data-topic="${esc(t.topic)}" data-polarity="negative"
          aria-label="${esc(t.label)}: ${t.complaints} of ${t.reviews} reviews complained. Show these reviews.">
          <span class="topic-name">${esc(t.label)}</span>
          <span class="topic-track"><span class="topic-fill${t.complaints ? "" : " zero"}" style="display:block;width:${((t.complaintShare ?? 0) / max) * 100}%"></span></span>
          <span class="topic-value num">${fmtPct(t.complaintShare)} <span class="muted">${t.complaints} of ${t.reviews}</span></span>
          <span class="topic-change">${t.complaints + t.previousComplaints ? deltaChip(t.change, { good: "down", unit: " pts", digits: 0, scale: 100 }) : '<span class="muted">–</span>'}</span>
          <span class="topic-praise num">${t.praise ? `${t.praise} reviews` : '<span class="muted">none</span>'}</span>
        </button>`,
      )
      .join("")}
    <div class="card-foot">Change is ${esc(vs)}, in percentage points of complaint share. Topics are tagged by an AI model with a quoted phrase as evidence. See "How these numbers work".</div>`;
}

function renderGlossary() {
  const t = state.config.thresholds;
  const items = [
    ["Average rating", "The mean Booking.com score (out of 10) of reviews published in the period."],
    ["Week", "Monday to Sunday, Sydney time. \"This week\" runs to today."],
    ["Comparison", "This week is compared with all of last week. Other periods are compared with the period of the same length just before."],
    ["Positive and negative", `Positive is ${t.positive} or more. Negative is below ${t.negative}. Anything in between is neutral.`],
    ["Complaint share", "Reviews with a complaint about the topic, divided by all reviews in the period."],
    ["Share of negative reviews", "Negative reviews mentioning the topic, divided by all negative reviews. This is the \"X% of negative reviews mentioned...\" sentence."],
    ["Few reviews", `Fewer than ${state.dashboard?.lowVolume ?? 5} reviews. Averages from small samples swing a lot, so read them with care.`],
    ["Topics", "An AI model tags each review with topics and a short quote as evidence. Tags whose quote is not in the review are discarded. Tagging is not perfect: sarcasm and very short reviews are hard."],
  ];
  $("glossary").innerHTML = items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

/* ---------------- Reviews feed ---------------- */

const bandWord = { positive: "Positive", neutral: "Neutral", negative: "Negative" };

function reviewCard(r) {
  const facts = [
    r.travellerType,
    r.country,
    r.roomName,
    r.nights ? plural(r.nights, "night") : null,
    r.stayDate ? `stayed ${monthFmt.format(toUtc(r.stayDate))}` : null,
  ].filter(Boolean);
  const chips = (r.topics ?? [])
    .map(
      (t) => `<span class="chip ${esc(t.polarity)}" title="${esc(t.evidence)}">${t.polarity === "positive" ? "+" : "−"} ${esc(topicLabel(t.topic))}<span class="sr-only"> (${esc(t.polarity)})</span></span>`,
    )
    .join("");
  let analysis = "";
  if (r.enrichmentStatus === "pending" || r.enrichmentStatus === "failed") analysis = '<span class="chip">Topics not analysed yet</span>';
  const noText = !r.title && !r.liked && !r.disliked;
  return `<article class="review">
    <div>
      <div class="score ${esc(r.band)} num" aria-label="Rated ${fmtRating(r.rating)} out of 10">${fmtRating(r.rating)}</div>
      <div class="score-word">${bandWord[r.band]}</div>
    </div>
    <div>
      <div class="review-head">
        <span class="review-prop">${esc(r.propertyName)}</span>
        <span class="review-date">Reviewed ${esc(fmtYear(sydneyDate(r.reviewDate)))}</span>
        ${r.ratingPrecision === "rounded" ? '<span class="badge" title="Source gave a 1 to 5 score, doubled for this scale">Converted score</span>' : ""}
      </div>
      ${facts.length ? `<div class="review-facts">${facts.map(esc).join(" · ")}</div>` : ""}
      ${r.title ? `<p class="review-title">“${esc(r.title)}”</p>` : ""}
      ${r.liked ? `<div class="review-text liked"><span class="sign" aria-label="Liked">+</span><span>${esc(r.liked)}</span></div>` : ""}
      ${r.disliked ? `<div class="review-text disliked"><span class="sign" aria-label="Disliked">−</span><span>${esc(r.disliked)}</span></div>` : ""}
      ${noText ? '<p class="muted" style="margin-top:8px">Rating only, no written comments.</p>' : ""}
      ${chips || analysis ? `<div class="chips">${chips}${analysis}</div>` : ""}
      ${r.reply || r.reviewUrl
        ? `<div class="review-foot">
            ${r.reply ? `<details><summary>Property replied</summary><div class="reply">${esc(r.reply)}</div></details>` : '<span class="muted">No reply from the property</span>'}
            ${r.reviewUrl ? `<a href="${esc(r.reviewUrl)}" target="_blank" rel="noopener">Open on Booking.com ↗</a>` : ""}
          </div>`
        : ""}
    </div>
  </article>`;
}

function topicLabel(id) {
  return state.config.topics.find((t) => t.id === id)?.label ?? id;
}

function feedParams() {
  const f = state.feed;
  return {
    property: state.property,
    from: state.from,
    to: state.to,
    sentiment: f.sentiment,
    topic: f.topic,
    polarity: f.topic ? f.polarity : "",
    q: f.q,
    sort: f.sort,
    limit: 20,
    offset: f.offset,
  };
}

async function loadFeed({ append = false } = {}) {
  const f = state.feed;
  if (!append) {
    f.offset = 0;
    $("feed").innerHTML = Array.from({ length: 3 }, () => `<div class="review"><div>${skeleton(48)}</div><div>${skeleton(14)}<div style="height:10px"></div>${skeleton(60)}</div></div>`).join("");
    $("feedMore").hidden = true;
  }
  renderFeedMeta(true);
  try {
    const page = await api("reviews", feedParams());
    f.items = append ? f.items.concat(page.reviews) : page.reviews;
    f.total = page.total;
    renderFeed();
  } catch (error) {
    $("feed").innerHTML = errorState(error.message, "retry-feed");
    $("feedMore").hidden = true;
  }
}

function renderFeedMeta(loading = false) {
  const f = state.feed;
  const chips = [];
  if (f.topic) chips.push(`<button class="active-filter" type="button" data-clear="topic">${f.polarity === "negative" ? "Complaints about " : f.polarity === "positive" ? "Praise for " : ""}${esc(topicLabel(f.topic).toLowerCase())} <span aria-hidden="true">✕</span><span class="sr-only">Remove filter</span></button>`);
  const count = loading ? "Loading reviews" : f.total ? `Showing ${f.items.length} of ${plural(f.total, "review")}` : "No reviews";
  $("feedMeta").innerHTML = `<span>${count} · ${esc(fmtRange(state.from, state.to))}</span><span style="display:flex;gap:6px">${chips.join("")}</span>`;
}

function renderFeed() {
  const f = state.feed;
  renderFeedMeta();
  if (!f.items.length) {
    $("feed").innerHTML = emptyState("No reviews match these filters", "Try a longer period, another property or fewer filters.");
    $("feedMore").hidden = true;
    return;
  }
  $("feed").innerHTML = f.items.map(reviewCard).join("");
  $("feedMore").hidden = f.items.length >= f.total;
}

function syncFeedControls() {
  document.querySelectorAll("#sentimentFilter button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sentiment === state.feed.sentiment)));
  $("topicSelect").value = state.feed.topic ? `${state.feed.topic}:${state.feed.polarity}` : "";
  $("sortSelect").value = state.feed.sort;
  $("searchInput").value = state.feed.q;
}

/* ---------------- Data health ---------------- */

async function loadHealth({ render = true } = {}) {
  if (render) $("health").innerHTML = `<div class="card card-body">${skeleton(160)}</div>`;
  try {
    state.health = await api("health");
    renderHealthPill();
    if (render) renderHealth();
  } catch (error) {
    $("healthPill").className = "pill bad";
    $("healthPill").innerHTML = '<span class="pill-dot"></span>Data unavailable';
    if (render) $("health").innerHTML = `<div class="card">${errorState(error.message, "retry-health")}</div>`;
  }
}

function renderHealthPill() {
  const h = state.health;
  const pill = $("healthPill");
  if (h.source === "sample") {
    pill.className = "pill muted";
    pill.innerHTML = '<span class="pill-dot"></span>Sample data';
  } else if (h.status === "ok") {
    pill.className = "pill ok";
    pill.innerHTML = '<span class="pill-dot"></span>Data up to date';
  } else {
    pill.className = "pill warn";
    pill.innerHTML = '<span class="pill-dot"></span>Check data';
  }
  const newest = h.properties.map((p) => p.newestReview).filter(Boolean).sort().at(-1);
  $("freshness").textContent = newest ? `Newest review ${fmtDay(sydneyDate(newest))}` : "";
  if (h.source === "sample") {
    const banner = $("sourceBanner");
    banner.hidden = false;
    banner.className = "banner";
    banner.style.marginBottom = "20px";
    banner.innerHTML = `${icons.warnTri}<span>Showing the saved sample of real reviews${h.exportedAt ? `, exported ${esc(fmtYear(sydneyDate(h.exportedAt)))}` : ""}. Live collection is not connected in this environment, so "this week" may have few or no reviews. Try "12 months".</span>`;
  }
}

const runStatus = {
  ingested: ["ok", "Completed"],
  enriched: ["ok", "Completed"],
  running: ["muted", "Running"],
  queued: ["muted", "Queued"],
  degraded: ["warn", "Partial"],
  failed: ["bad", "Failed"],
};

function renderHealth() {
  const h = state.health;
  const rows = h.properties
    .map((p) => {
      const e = p.enrichment;
      const analysable = e.done + e.pending + e.failed;
      return `<tr>
        <td><div class="prop-name">${esc(p.name)}</div></td>
        <td class="r num">${p.reviews}</td>
        <td>${p.newestReview ? esc(fmtYear(sydneyDate(p.newestReview))) : '<span class="muted">none</span>'}</td>
        <td>${p.lastCollected ? esc(relativeTime(p.lastCollected)) : '<span class="muted">unknown</span>'}</td>
        <td class="r num">${analysable ? fmtPct(e.done / analysable) : "–"}<div class="prop-sub">${e.done} of ${analysable}</div></td>
        <td class="r num">${e.pending ? `<span class="badge">${e.pending} waiting</span>` : "0"}</td>
        <td class="r num">${e.skipped}</td>
      </tr>`;
    })
    .join("");
  const runs = h.runs?.length
    ? `<div class="table-wrap"><table><thead><tr><th>Started</th><th>Trigger</th><th>Result</th><th class="r">Fetched</th><th class="r">New</th><th class="r">Updated</th><th class="r">Unchanged</th><th class="r">Rejected</th><th>Note</th></tr></thead><tbody>
      ${h.runs
        .map((r) => {
          const [cls, word] = runStatus[r.status] ?? ["muted", r.status];
          return `<tr><td>${esc(relativeTime(r.started_at))}</td><td>${esc(r.trigger)}</td><td><span class="pill ${cls}"><span class="pill-dot"></span>${esc(word)}</span></td>
            <td class="r num">${r.items_fetched}</td><td class="r num">${r.created}</td><td class="r num">${r.updated}</td><td class="r num">${r.unchanged}</td><td class="r num">${r.rejected}</td>
            <td class="muted" style="max-width:280px">${esc(r.error ?? "")}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : emptyState("No collection runs recorded", h.source === "sample" ? "Runs are shown when the dashboard is connected to the live database." : "");

  const problem = h.recentProblems?.[0];
  const summary =
    h.status === "ok"
      ? `<div class="all-clear">${icons.okCircle}<span>All four properties have data${h.lastSuccessfulRun ? ` and the last successful collection was ${esc(relativeTime(h.lastSuccessfulRun.finished_at ?? h.lastSuccessfulRun.started_at))}` : ""}.</span></div>`
      : `<div class="banner">${icons.warnTri}<span>${problem ? `The latest collection ${problem.status === "failed" ? "failed" : "was only partly successful"}: ${esc(problem.error ?? "see the run list below")}. Existing reviews are kept; nothing was deleted.` : "At least one property has no reviews stored."}</span></div>`;

  $("health").innerHTML = `
    <section class="card"><div class="card-body">${summary}</div></section>
    <section class="card">
      <div class="card-head"><div><h2 class="card-title">By property</h2><p class="card-sub">"Analysed" means topics have been tagged. Reviews without text are rating only and are not analysed.</p></div></div>
      <div class="card-body" style="padding:12px 0 0"><div class="table-wrap"><table>
        <thead><tr><th>Property</th><th class="r">Reviews stored</th><th>Newest review</th><th>Last collected</th><th class="r">Analysed</th><th class="r">Waiting</th><th class="r">Rating only</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2 class="card-title">Recent collection runs</h2><p class="card-sub">One run per property per day. Duplicates are recognised and skipped.</p></div></div>
      <div class="card-body" style="padding:12px 0 0">${runs}</div>
    </section>`;
}

/* ---------------- Controls ---------------- */

function applyPeriodState() {
  const today = state.today;
  if (state.preset === "custom") {
    if (!state.from || !state.to) Object.assign(state, presetRange("4-weeks", today));
    state.compareFrom = null;
    state.compareTo = null;
  } else {
    const r = presetRange(state.preset, today) ?? presetRange("this-week", today);
    state.from = r.from;
    state.to = r.to;
    state.compareFrom = r.compareFrom ?? null;
    state.compareTo = r.compareTo ?? null;
  }
  document.querySelectorAll("#periodPresets button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === state.preset)));
  $("customRange").classList.toggle("open", state.preset === "custom");
  $("fromDate").value = state.from;
  $("toDate").value = state.to;
  $("fromDate").max = today;
  $("toDate").max = today;

  const len = daysBetween(state.from, state.to);
  const cFrom = state.compareFrom ?? addDays(state.from, -len);
  const cTo = state.compareTo ?? addDays(state.from, -1);
  $("periodCaption").innerHTML = `<strong>${esc(fmtRange(state.from, state.to))}</strong> compared with ${esc(fmtRange(cFrom, cTo))}`;
}

function refresh() {
  applyPeriodState();
  writeUrl();
  if (state.tab === "overview") loadOverview();
  if (state.tab === "reviews") loadFeed();
  // Keep the other tab fresh on next visit.
  state.stale = { overview: state.tab !== "overview", reviews: state.tab !== "reviews" };
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));
  for (const name of ["overview", "reviews", "health"]) $(`panel-${name}`).hidden = name !== tab;
  writeUrl();
  if (tab === "overview" && (state.stale?.overview || !state.dashboard)) {
    state.stale.overview = false;
    loadOverview();
  }
  if (tab === "reviews" && (state.stale?.reviews ?? true)) {
    state.stale = { ...state.stale, reviews: false };
    syncFeedControls();
    loadFeed();
  }
  if (tab === "health") loadHealth();
  window.scrollTo({ top: 0 });
}

function openTopic(topic, polarity) {
  state.feed.topic = topic;
  state.feed.polarity = polarity;
  state.feed.sentiment = "";
  state.stale = { ...state.stale, reviews: true };
  setTab("reviews");
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  $("healthPill").addEventListener("click", () => setTab("health"));

  $("propertySelect").addEventListener("change", (e) => {
    state.property = e.target.value;
    refresh();
  });

  document.querySelectorAll("#periodPresets button").forEach((b) =>
    b.addEventListener("click", () => {
      state.preset = b.dataset.preset;
      if (state.preset === "custom") {
        applyPeriodState();
        $("fromDate").focus();
        return;
      }
      refresh();
    }),
  );

  $("applyRange").addEventListener("click", () => {
    const from = $("fromDate").value;
    const to = $("toDate").value;
    if (!from || !to || from > to) {
      $("periodCaption").textContent = "Choose a start date on or before the end date.";
      return;
    }
    state.from = from;
    state.to = to;
    refresh();
  });

  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-topic], [data-property], [data-action], [data-clear]");
    if (!target || e.target.closest("[data-stop]")) return;
    if (target.dataset.topic) openTopic(target.dataset.topic, target.dataset.polarity ?? "");
    else if (target.dataset.property) {
      state.property = state.property === target.dataset.property ? "" : target.dataset.property;
      $("propertySelect").value = state.property;
      refresh();
    } else if (target.dataset.action === "retry") loadOverview();
    else if (target.dataset.action === "retry-feed") loadFeed();
    else if (target.dataset.action === "retry-health") loadHealth();
    else if (target.dataset.clear === "topic") {
      state.feed.topic = "";
      state.feed.polarity = "";
      syncFeedControls();
      writeUrl();
      loadFeed();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("tr[data-property]")) {
      e.preventDefault();
      e.target.click();
    }
  });

  document.querySelectorAll("#sentimentFilter button").forEach((b) =>
    b.addEventListener("click", () => {
      state.feed.sentiment = b.dataset.sentiment;
      syncFeedControls();
      writeUrl();
      loadFeed();
    }),
  );

  $("topicSelect").addEventListener("change", (e) => {
    const [topic, polarity] = e.target.value.split(":");
    state.feed.topic = topic ?? "";
    state.feed.polarity = polarity ?? "";
    writeUrl();
    loadFeed();
  });

  $("sortSelect").addEventListener("change", (e) => {
    state.feed.sort = e.target.value;
    loadFeed();
  });

  let timer;
  $("searchInput").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.feed.q = e.target.value.trim();
      loadFeed();
    }, 300);
  });

  $("loadMore").addEventListener("click", () => {
    state.feed.offset += 20;
    loadFeed({ append: true });
  });

  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.dashboard && state.tab === "overview") {
        renderVolumeChart(state.dashboard);
        renderRatingChart(state.dashboard);
      }
    }, 150);
  });
}

/* ---------------- Start ---------------- */

async function init() {
  readUrl();
  bindEvents();
  try {
    state.config = await api("config");
  } catch (error) {
    $("kpis").innerHTML = `<div class="card" style="grid-column:1/-1"><div class="state" role="alert"><p class="state-title">The dashboard could not start</p><p>${esc(error.message)}</p><button class="btn" type="button" onclick="location.reload()">Reload</button></div></div>`;
    return;
  }
  state.today = state.config.today;
  if (state.property && !state.config.properties.some((p) => p.id === state.property)) state.property = "";

  $("propertySelect").innerHTML =
    '<option value="">All properties</option>' +
    state.config.properties.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  $("propertySelect").value = state.property;
  $("topicSelect").innerHTML =
    '<option value="">All topics</option>' +
    state.config.topics
      .map((t) => `<option value="${esc(t.id)}:negative">Complaints: ${esc(t.label)}</option>`)
      .join("") +
    state.config.topics.map((t) => `<option value="${esc(t.id)}:positive">Praise: ${esc(t.label)}</option>`).join("");
  renderGlossary();

  applyPeriodState();
  state.stale = { overview: true, reviews: true };
  loadHealth({ render: false });
  setTab(state.tab);
}

init();
