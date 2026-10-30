#!/usr/bin/env bash
# Maintenance backup: briefly stops the ChatFinity API so database and attachments agree.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup_dir="${1:-.data/backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd)"
compose=(docker compose --env-file .env.production -f deploy/compose.yml)
api_was_running="$(${compose[@]} ps --status running -q api)"
restore_api(){ if [[ -n "$api_was_running" ]]; then "${compose[@]}" start api >/dev/null; fi; }
trap restore_api EXIT
if [[ -n "$api_was_running" ]]; then "${compose[@]}" stop api; fi
"${compose[@]}" exec -T db pg_dump -U chatfinity -d chatfinity -Fc > "$backup_dir/database.dump"
"${compose[@]}" run --rm --no-deps --entrypoint tar api -czf - -C /data/uploads . > "$backup_dir/attachments.tar.gz"
sha256sum "$backup_dir/database.dump" "$backup_dir/attachments.tar.gz" > "$backup_dir/SHA256SUMS"
printf 'Backup saved to %s. Protect and encrypt it; it contains private conversations.\n' "$backup_dir"
