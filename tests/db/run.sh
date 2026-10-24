#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres (with a small Supabase stand-in) and runs tests/db/access.sql.
# Run: bash tests/db/run.sh        (in CI a postgres service is used instead: set DATABASE_URL)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
if [ -n "${DATABASE_URL:-}" ]; then
  psql_() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }
else
  bin=$(ls -d /usr/lib/postgresql/*/bin | tail -1); dir=$(mktemp -d); chmod 755 "$dir"; chown postgres "$dir" 2>/dev/null || true
  as() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
  as "$bin/initdb -D $dir/data -A trust -U postgres >/dev/null"
  as "$bin/pg_ctl -D $dir/data -o '-p 54399 -k $dir -c listen_addresses=' -l $dir/log -w start >/dev/null"
  trap 'as "$bin/pg_ctl -D $dir/data -m immediate stop >/dev/null" || true; rm -rf "$dir"' EXIT
  psql_() { psql -h "$dir" -p 54399 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
fi
psql_ -f "$here/stub.sql"
for f in $(ls "$root"/supabase/migrations/*.sql | sort); do psql_ -f "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }; done
psql_ -f "$here/access.sql"
