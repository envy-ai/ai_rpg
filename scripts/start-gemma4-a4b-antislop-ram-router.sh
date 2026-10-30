#!/usr/bin/env bash
set -euo pipefail

readonly gemma_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export ARTEMIS_SOURCE_MODEL="/d/llms/Gemma-4-26B-A4B-it-heretic-antislop.Q5_K_S.gguf"
export ARTEMIS_SHM_MODELS_DIR="/dev/shm/ai-rpg-gemma4-a4b-antislop-models"

exec "$gemma_script_dir/start-artemis-ram-router.sh" "$@"
