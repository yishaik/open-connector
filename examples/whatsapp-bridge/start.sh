#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ -f .env && ! -L .env ]] || { echo "Create a private .env first." >&2; exit 1; }
[[ "$(stat -c %a .env)" == 600 ]] || { echo "Set chmod 600 .env." >&2; exit 1; }
# Read only the needed value without executing shell from the dotenv file.
data="$(sed -n 's/^WA_HOST_DATA_DIR=//p' .env)"
[[ "$data" == /* && -d "$data" ]] || { echo "Set an existing absolute WA_HOST_DATA_DIR." >&2; exit 1; }
data="$(realpath -- "$data")"
source_dev="$(findmnt -n -o SOURCE --target "$data")"
source_dev="${source_dev%%\[*}"
[[ -b "$source_dev" ]] || { echo "Cannot verify an encrypted Linux block device." >&2; exit 1; }
lsblk -s -n -r -o TYPE "$source_dev" | grep -x crypt >/dev/null || { echo "Refusing data directory without verified dm-crypt backing." >&2; exit 1; }
[[ "$(stat -c %u:%g:%a "$data")" == 10001:10001:700 ]] || { echo "Data directory must be owned by 10001:10001 with mode 700." >&2; exit 1; }
export WA_HOST_DATA_DIR="$data"
exec docker compose -f compose.yml up -d --build
