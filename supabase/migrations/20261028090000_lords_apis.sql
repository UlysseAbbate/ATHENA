-- LIBBY's business pages now come from the UK Parliament What's On API and the Lords Business API (scripts/libby/ingest_whatson.py and
-- ingest_lordsbusiness.py). The APIs say more than the old web pages did; these columns keep it.
alter table whatson_events
  add column if not exists event_id  int,       -- the event's id in the What's On API (the speakers list is looked up with it)
  add column if not exists end_time  text,
  add column if not exists location  text,
  add column if not exists bill_id   int,       -- the Bill the event is about (Parliament's Bill id, as on the Legislation page)
  add column if not exists bill_name text,
  add column if not exists committee text;      -- the committee's name, for committee meetings

alter table whips_business
  add column if not exists item_id   int,       -- the item's id in the Lords Business API
  add column if not exists member_id int;       -- the member named first on the item (Parliament's member id)
