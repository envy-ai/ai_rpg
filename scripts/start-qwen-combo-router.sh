#!/usr/bin/env bash
set -euo pipefail

exec /home/bart/prism-llama-bonsai-27b/start-router.sh \
    --no-mmproj \
    --models-preset /home/bart/ai_rpg/config/llama-qwen-combo-text-only.ini \
    --ctx-size 105000 \
    "$@"
