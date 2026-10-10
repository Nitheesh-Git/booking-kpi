create extension if not exists pgcrypto;

create table properties (
  id text primary key,
  name text not null,
  booking_url text not null unique
);

insert into properties (id, name, booking_url) values
  ('olympic-paddington', 'Olympic Hotel Paddington', 'https://www.booking.com/hotel/au/olympic-paddington.html'),
  ('potts-point', 'Potts Point', 'https://www.booking.com/hotel/au/venus-potts-point-sydney.html'),
  ('central-sydney', 'Central Sydney', 'https://www.booking.com/hotel/au/venus-surry-hills.html'),
  ('darling-harbour', 'Darling Harbour', 'https://www.booking.com/hotel/au/chateau-de-venus.html');

create table scrape_runs (
  id uuid primary key default gen_random_uuid(), trigger text not null check (trigger in ('cron', 'manual', 'cli', 'import')),
  apify_run_id text unique, status text not null check (status in ('queued', 'running', 'ingested', 'enriched', 'degraded', 'failed')),
  cutoff_date date, started_at timestamptz not null default now(), finished_at timestamptz, items_fetched integer not null default 0,
  created integer not null default 0, updated integer not null default 0, unchanged integer not null default 0, rejected integer not null default 0, error text
);

create table reviews (
  id uuid primary key default gen_random_uuid(), property_id text not null references properties(id), source text not null default 'booking', source_review_id text,
  dedupe_key text not null, rating_10 numeric(3,1) not null check (rating_10 between 0 and 10), rating_scale smallint not null check (rating_scale in (5, 10)),
  rating_precision text not null check (rating_precision in ('exact', 'rounded')), title text, liked_text text, disliked_text text, review_date timestamptz not null,
  stay_date date, reviewer_country text, traveller_type text, room_name text, nights integer check (nights > 0), reply_text text, review_url text,
  content_hash text not null, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(), run_id uuid references scrape_runs(id),
  unique (property_id, dedupe_key)
);

create table review_enrichment (
  review_id uuid primary key references reviews(id) on delete cascade, status text not null check (status in ('pending', 'done', 'failed', 'skipped')),
  attempts integer not null default 0, provider text, model text, prompt_version text, sentiment_score numeric(3,2), error text, enriched_at timestamptz
);

create table review_topics (
  review_id uuid not null references reviews(id) on delete cascade, topic text not null, polarity text not null check (polarity in ('positive', 'negative')),
  severity smallint not null check (severity between 1 and 3), evidence text not null, primary key (review_id, topic, polarity, evidence)
);

create table rejected_items (id uuid primary key default gen_random_uuid(), run_id uuid references scrape_runs(id) on delete cascade, reason text not null, payload jsonb not null, created_at timestamptz not null default now());
create index reviews_property_review_date_idx on reviews (property_id, review_date desc);
create index review_topics_topic_polarity_idx on review_topics (topic, polarity);
alter table properties enable row level security;
alter table scrape_runs enable row level security;
alter table reviews enable row level security;
alter table review_enrichment enable row level security;
alter table review_topics enable row level security;
alter table rejected_items enable row level security;
