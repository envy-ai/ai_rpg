#!/usr/bin/env bash
set -euo pipefail

readonly artemis_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export ARTEMIS_SOURCE_MODEL='/d/llms/Artemis-31B-v1.2-NVFP4.gguf'
export ARTEMIS_SHM_MODELS_DIR='/dev/shm/ai-rpg-artemis-v1.2-nvfp4-models'

exec "$artemis_script_dir/start-artemis-ram-router.sh" "$@"
