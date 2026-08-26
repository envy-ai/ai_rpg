#!/usr/bin/env bash
set -euo pipefail

readonly router_binary="/home/bart/prism-llama-bonsai-27b/bin-streaming-logprobs-tools/llama-server"
readonly router_host="${HOST:-0.0.0.0}"
readonly router_port="${PORT:-5005}"
readonly router_context_size="${LLAMA_CTX_SIZE:-96000}"

exec "$router_binary" \
    --models-dir /d/llms \
    --host "$router_host" \
    --port "$router_port" \
    --flash-attn on \
    --ctx-size "$router_context_size" \
    --cache-type-k q8_0 \
    --cache-type-v q8_0 \
    --cache-ram 12288 \
    --slot-save-path /dev/shm \
    --parallel 1 \
    --temp 0.7 \
    --top-p 0.95 \
    --top-k 20 \
    --min-p 0 \
    --reasoning-budget 0 \
    --models-max 1 \
    --sleep-idle-seconds 120 \
    --chat-template-kwargs '{"enable_thinking":false}' \
    --jinja \
    --no-mmproj \
    --models-preset /home/bart/ai_rpg/config/llama-qwen-combo-text-only.ini \
    "$@"
