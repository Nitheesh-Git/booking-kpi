-- Field names each actor run delivered, and which review fields it left
-- empty, so actor output changes are visible without opening Apify.
alter table scrape_runs add column if not exists notes text;
