#!/usr/bin/env bash
set -euo pipefail

readonly merousis_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export ARTEMIS_SOURCE_MODEL="/d/llms/Merousis-26B-A4B.Q5_K_M.gguf"
export ARTEMIS_SHM_MODELS_DIR="/dev/shm/ai-rpg-merousis-a4b-models"

exec "$merousis_script_dir/start-artemis-ram-router.sh" "$@"
