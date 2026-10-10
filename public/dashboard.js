/**
 * Azzurro Review Insights — Interactive Dashboard Client
 */

let state = {
  properties: [],
  selectedProperty: "",
  selectedDays: "90",
  selectedTopic: "",
  selectedPolarity: "", // "" | "positive" | "negative"
  kpis: null,
  reviews: [],
  reviewsTotal: 0,
};

async function init() {
  await loadProperties();
  await refreshDashboard();
  setupEventListeners();
}

async function loadProperties() {
  try {
    const res = await fetch("/api/properties");
    if (!res.ok) throw new Error("Failed to load properties");
    state.properties = await res.json();

    const select = document.getElementById("propertySelect");
    select.innerHTML = `<option value="">All Properties (${state.properties.length})</option>`;
    for (const p of state.properties) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.totalReviews} reviews)`;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error("Could not load properties:", err);
  }
}

async function refreshDashboard() {
  await Promise.all([loadKpis(), loadReviews()]);
}

async function loadKpis() {
  const params = new URLSearchParams();
  if (state.selectedProperty) params.set("propertyId", state.selectedProperty);
  if (state.selectedDays) params.set("days", state.selectedDays);

  try {
    const res = await fetch(`/api/kpis?${params}`);
    if (!res.ok) throw new Error("Failed to load KPIs");
    state.kpis = await res.json();
    renderKpis();
    renderTrend();
    renderTopics();
  } catch (err) {
    console.error("KPI load error:", err);
  }
}

function renderKpis() {
  const { rating, sentiment } = state.kpis || {};

  // Rating
  document.getElementById("avgRating").textContent =
    rating?.averageRating != null ? rating.averageRating.toFixed(1) : "–";
  document.getElementById("totalReviews").textContent =
    `${rating?.totalReviews ?? 0} reviews total`;

  // Sentiment
  document.getElementById("avgSentiment").textContent =
    sentiment?.averageSentiment != null
      ? `${Math.round(sentiment.averageSentiment * 100)}%`
      : "–";
  document.getElementById("enrichedReviews").textContent =
    `${sentiment?.enrichedCount ?? 0} enriched`;
  document.getElementById("sentimentBar").style.width =
    sentiment?.averageSentiment != null
      ? `${Math.round(sentiment.averageSentiment * 100)}%`
      : "0%";

  // Bands
  const posPct = rating?.positiveRate != null ? Math.round(rating.positiveRate * 100) : 0;
  const neuPct = rating?.totalReviews ? Math.round((rating.neutralCount / rating.totalReviews) * 100) : 0;
  const negPct = rating?.negativeRate != null ? Math.round(rating.negativeRate * 100) : 0;

  document.getElementById("posPct").textContent = `${posPct}%`;
  document.getElementById("posCount").textContent = `${rating?.positiveCount ?? 0} reviews`;
  document.getElementById("posBar").style.width = `${posPct}%`;

  document.getElementById("neuPct").textContent = `${neuPct}%`;
  document.getElementById("neuCount").textContent = `${rating?.neutralCount ?? 0} reviews`;
  document.getElementById("neuBar").style.width = `${neuPct}%`;

  document.getElementById("negPct").textContent = `${negPct}%`;
  document.getElementById("negCount").textContent = `${rating?.negativeCount ?? 0} reviews`;
  document.getElementById("negBar").style.width = `${negPct}%`;
}

function renderTrend() {
  const container = document.getElementById("trendChart");
  const trend = state.kpis?.trend ?? [];

  if (!trend.length) {
    container.innerHTML = `<div class="empty-state">No trend data for this period</div>`;
    return;
  }

  container.innerHTML = "";
  for (const item of trend) {
    const col = document.createElement("div");
    col.className = "trend-col";

    const heightPct = Math.max(5, (item.averageRating / 10) * 100);

    col.innerHTML = `
      <span class="trend-score">${item.averageRating.toFixed(1)}</span>
      <div class="trend-bar" style="height: ${heightPct}%;" title="${item.weekStart}: ${item.averageRating} (${item.count} reviews)"></div>
      <span class="trend-label">${item.weekStart.slice(5)}</span>
    `;
    container.appendChild(col);
  }
}

function renderTopics() {
  const container = document.getElementById("topicList");
  const topics = state.kpis?.topics ?? [];

  if (!topics.length) {
    container.innerHTML = `<div class="empty-state">No topic insights available yet</div>`;
    return;
  }

  container.innerHTML = "";
  for (const t of topics) {
    const row = document.createElement("div");
    row.className = `topic-row ${state.selectedTopic === t.topic ? "active" : ""}`;
    row.onclick = () => {
      state.selectedTopic = state.selectedTopic === t.topic ? "" : t.topic;
      renderTopics();
      loadReviews();
    };

    const posPct = t.total > 0 ? (t.positiveCount / t.total) * 100 : 0;
    const negPct = 100 - posPct;

    row.innerHTML = `
      <span class="topic-name">${t.topic.replace("_", " ")}</span>
      <div class="topic-stats">
        <div class="topic-split-bar">
          <div class="split-positive" style="width: ${posPct}%" title="${t.positiveCount} positive"></div>
          <div class="split-negative" style="width: ${negPct}%" title="${t.negativeCount} negative"></div>
        </div>
        <span class="topic-counts">${t.total} total</span>
      </div>
    `;
    container.appendChild(row);
  }
}

async function loadReviews() {
  const params = new URLSearchParams();
  if (state.selectedProperty) params.set("propertyId", state.selectedProperty);
  if (state.selectedTopic) params.set("topic", state.selectedTopic);
  params.set("limit", "25");

  try {
    const res = await fetch(`/api/reviews?${params}`);
    if (!res.ok) throw new Error("Failed to load reviews");
    const data = await res.json();
    state.reviews = data.reviews ?? [];
    state.reviewsTotal = data.total ?? 0;
    renderReviews();
  } catch (err) {
    console.error("Reviews load error:", err);
  }
}

function renderReviews() {
  const container = document.getElementById("reviewsFeed");
  const filtered = state.reviews.filter((r) => {
    if (!state.selectedPolarity) return true;
    if (state.selectedPolarity === "positive") return r.rating10 >= 8;
    if (state.selectedPolarity === "negative") return r.rating10 < 6;
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">No reviews match the selected filters.</div>`;
    return;
  }

  container.innerHTML = "";
  for (const r of filtered) {
    const card = document.createElement("div");
    card.className = "review-card";

    let ratingClass = "rating-neu";
    if (r.rating10 >= 8) ratingClass = "rating-pos";
    else if (r.rating10 < 6) ratingClass = "rating-neg";

    const propName =
      state.properties.find((p) => p.id === r.propertyId)?.name ?? r.propertyId;

    let topicsHtml = "";
    if (r.topics && r.topics.length) {
      topicsHtml = `
        <div class="topics-extracted">
          ${r.topics
            .map(
              (t) =>
                `<span class="topic-chip ${t.polarity === "positive" ? "chip-pos" : "chip-neg"}">
                  ${t.polarity === "positive" ? "+" : "–"}${t.topic.replace("_", " ")}
                  ${t.evidence ? `<em>"${t.evidence}"</em>` : ""}
                </span>`,
            )
            .join("")}
        </div>`;
    }

    let replyHtml = "";
    if (r.replyText) {
      replyHtml = `
        <div class="reply-box">
          <strong>Hotel Response</strong>
          ${r.replyText}
        </div>`;
    }

    card.innerHTML = `
      <div class="review-card-top">
        <div class="meta-group">
          <span class="prop-badge">${propName}</span>
          <span class="date-text">${r.reviewDate ? r.reviewDate.slice(0, 10) : ""}</span>
          ${r.roomName ? `<span class="date-text">• ${r.roomName}</span>` : ""}
          ${r.reviewerCountry ? `<span class="date-text">• ${r.reviewerCountry}</span>` : ""}
        </div>
        <span class="rating-badge ${ratingClass}">${r.rating10.toFixed(1)} / 10</span>
      </div>

      ${r.title ? `<div class="review-title">${r.title}</div>` : ""}
      ${r.likedText ? `<div class="review-text-block"><span class="tag-pos">Liked</span> <span>${r.likedText}</span></div>` : ""}
      ${r.dislikedText ? `<div class="review-text-block"><span class="tag-neg">Disliked</span> <span>${r.dislikedText}</span></div>` : ""}

      ${topicsHtml}
      ${replyHtml}
    `;

    container.appendChild(card);
  }
}

function setupEventListeners() {
  document.getElementById("propertySelect").addEventListener("change", (e) => {
    state.selectedProperty = e.target.value;
    refreshDashboard();
  });

  document.getElementById("daysSelect").addEventListener("change", (e) => {
    state.selectedDays = e.target.value;
    refreshDashboard();
  });

  document.querySelectorAll(".feed-filters .btn-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".feed-filters .btn-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.selectedPolarity = btn.dataset.polarity || "";
      renderReviews();
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
