-- LIBBY: a second room (Room 391, booked exactly like the Wallace Room) and Work Experience Support.
-- Every booking now says which room it is for; the database still refuses two bookings of the SAME room that overlap.

create extension if not exists btree_gist with schema extensions;

alter table public.room_series   add column if not exists room text not null default 'wallace' check (room in ('wallace', '391'));
alter table public.room_bookings add column if not exists room text not null default 'wallace' check (room in ('wallace', '391'));

do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.room_bookings'::regclass and contype = 'x';
  if c is not null then execute format('alter table public.room_bookings drop constraint %I', c); end if;
end $$;
alter table public.room_bookings add constraint room_bookings_no_overlap exclude using gist (room with =, tsrange(start_at, end_at) with &&);
create index if not exists room_bookings_room_idx on public.room_bookings (room, start_at);

-- Work Experience Support: someone asks for a Peer to host work experience students at a date and time; Peers say they can.
create table if not exists public.work_experience_requests (
  id          bigserial primary key,
  requester   text not null,
  contact     text,
  day         date not null,
  start_time  time not null,
  end_time    time not null,
  students    int  not null default 1 check (students between 1 and 50),
  note        text,
  created_at  timestamptz default now(),
  check (end_time > start_time)
);
create table if not exists public.work_experience_offers (
  id          bigserial primary key,
  request_id  bigint not null references public.work_experience_requests(id) on delete cascade,
  peer        text not null,
  note        text,
  created_at  timestamptz default now()
);
create index if not exists work_experience_requests_day_idx on public.work_experience_requests (day);
create index if not exists work_experience_offers_request_idx on public.work_experience_offers (request_id);
alter table public.work_experience_requests enable row level security;
alter table public.work_experience_offers enable row level security;
-- like the rest of LIBBY's tables, the browser never talks to these: the API does, with the service role
revoke all on public.work_experience_requests, public.work_experience_offers from anon, authenticated;
revoke all on sequence public.work_experience_requests_id_seq, public.work_experience_offers_id_seq from anon, authenticated;
