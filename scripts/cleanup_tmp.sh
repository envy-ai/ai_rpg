#!/usr/bin/env bash

# Remove temporary artifacts older than seven days while retaining tmp/ itself.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(cd -- "$script_dir/.." && pwd)/tmp"

if [[ ! -d "$tmp_dir" ]]; then
  printf 'Temporary directory does not exist: %s\n' "$tmp_dir" >&2
  exit 1
fi

find "$tmp_dir" -mindepth 1 -depth -not -newermt '7 days ago' -delete
