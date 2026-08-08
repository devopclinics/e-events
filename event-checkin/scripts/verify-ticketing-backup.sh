#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${COMPOSE_FILE:-$repo_dir/docker-compose.prod.yaml}"
verification_dir="$(mktemp -d)"
trap 'rm -rf "$verification_dir"' EXIT
dump_file="$verification_dir/ticketing.dump"

cd "$repo_dir"
docker compose -f "$compose_file" exec -T ticketing-db \
  pg_dump -U ticketing -d ticketing --format=custom --no-owner --no-acl > "$dump_file"

test -s "$dump_file"
docker compose -f "$compose_file" exec -T ticketing-db \
  pg_restore --list < "$dump_file" > "$verification_dir/contents.txt"

required_tables=(orders order_items payment_refunds journal_lines ticket_transfers waitlist_entries audit_events)
for table_name in "${required_tables[@]}"; do
  if ! grep -Eq "TABLE( DATA)? public ${table_name}" "$verification_dir/contents.txt"; then
    echo "Backup verification failed: ${table_name} is missing" >&2
    exit 1
  fi
done

size_bytes="$(wc -c < "$dump_file" | tr -d ' ')"
object_count="$(wc -l < "$verification_dir/contents.txt" | tr -d ' ')"
echo "Ticketing backup verified: ${size_bytes} bytes, ${object_count} archive objects, ${#required_tables[@]} critical tables present."
