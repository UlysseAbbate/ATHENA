-- Room bookings (Wallace Room, Room 391): who may see who booked, requests to move a booking, and bookings "set in stone".
--   booked_by_email: the account that made the booking, so its owner always sees it in full (everyone else below the Whips sees just "Booked")
--   locked:          a booking "set in stone": nobody can ask for it to be moved (the Whips and the booker can still amend it)
--   room_requests:   a request for a booked slot, with a message, shown to the current booker (and to the Whips) so they can change their meeting
alter table public.room_bookings add column if not exists booked_by_email text;
alter table public.room_bookings add column if not exists locked boolean not null default false;
alter table public.room_series   add column if not exists booked_by_email text;
create index if not exists room_bookings_owner_idx on public.room_bookings (booked_by_email);

create table if not exists public.room_requests (
  id              bigserial primary key,
  booking_id      bigint references public.room_bookings(id) on delete set null,
  room            text not null check (room in ('wallace', '391')),
  booking_date    date not null,
  start_hm        text not null,
  end_hm          text not null,
  booker_email    text,                        -- who held the booking when it was asked for (null: made before bookings knew their owner)
  booker_name     text,
  requester_email text not null,
  requester_name  text,
  message         text not null,
  status          text not null default 'open' check (status in ('open', 'will-move', 'cannot-move', 'withdrawn', 'released')),
  response        text,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz
);
create index if not exists room_requests_booker_idx on public.room_requests (booker_email, status);
create index if not exists room_requests_requester_idx on public.room_requests (requester_email);
alter table public.room_requests enable row level security;
revoke all on public.room_requests from anon, authenticated;
revoke all on sequence public.room_requests_id_seq from anon, authenticated;
