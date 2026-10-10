-- Record which actor and property each collection run was for, so ingest
-- applies the right rating scale and can fall back to the next actor.
alter table scrape_runs add column if not exists actor text;
alter table scrape_runs add column if not exists property_id text references properties(id);
create index if not exists scrape_runs_status_idx on scrape_runs (status);
