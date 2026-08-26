#!/usr/bin/env bash
set -euo pipefail

readonly all_models_llama_binary="${ALL_MODELS_LLAMA_BINARY:-/home/bart/prism-llama-bonsai-27b/bin-streaming-logprobs-tools/llama-server}"
readonly all_models_source_dir="${ALL_MODELS_SOURCE_DIR:-/d/llms}"
readonly all_models_catalog_dir="${ALL_MODELS_CATALOG_DIR:-/tmp/ai-rpg-all-model-catalog}"
readonly all_models_router_host="${ALL_MODELS_LLAMA_HOST:-0.0.0.0}"
readonly all_models_router_port="${ALL_MODELS_LLAMA_PORT:-5005}"
readonly all_models_context_size="${ALL_MODELS_LLAMA_CTX_SIZE:-105000}"
readonly all_models_sleep_idle_seconds="${ALL_MODELS_LLAMA_SLEEP_IDLE_SECONDS:-180}"

if [[ ! -x "$all_models_llama_binary" ]]; then
    printf 'llama.cpp router binary is not executable: %s\n' "$all_models_llama_binary" >&2
    exit 1
fi

if [[ ! -d "$all_models_source_dir" || ! -r "$all_models_source_dir" ]]; then
    printf 'Model source directory is not readable: %s\n' "$all_models_source_dir" >&2
    exit 1
fi

for all_models_required_command in basename find ln mkdir; do
    if ! command -v "$all_models_required_command" >/dev/null 2>&1; then
        printf 'Required command is unavailable: %s\n' "$all_models_required_command" >&2
        exit 1
    fi
done

mkdir -p -- "$all_models_catalog_dir"

while IFS= read -r -d '' all_models_catalog_entry; do
    if [[ ! -L "$all_models_catalog_entry" ]]; then
        printf 'All-model catalog contains an unexpected non-symlink entry: %s\n' "$all_models_catalog_entry" >&2
        exit 1
    fi
done < <(find "$all_models_catalog_dir" -mindepth 1 -maxdepth 1 -print0)

find "$all_models_catalog_dir" -mindepth 1 -maxdepth 1 -type l -delete

all_models_model_count=0
while IFS= read -r -d '' all_models_model_path; do
    all_models_model_name="$(basename -- "$all_models_model_path")"
    ln -s -- "$all_models_model_path" "$all_models_catalog_dir/$all_models_model_name"
    all_models_model_count=$((all_models_model_count + 1))
done < <(
    find "$all_models_source_dir" \
        -mindepth 1 \
        -maxdepth 1 \
        -type f \
        -iname '*.gguf' \
        ! -iname '*mmproj*' \
        -print0
)

if (( all_models_model_count == 0 )); then
    printf 'No text-model GGUF files were found in %s.\n' "$all_models_source_dir" >&2
    exit 1
fi

printf 'Exposing %d text models from %s with a %s-token context.\n' \
    "$all_models_model_count" "$all_models_source_dir" "$all_models_context_size"

exec "$all_models_llama_binary" \
    --models-dir "$all_models_catalog_dir" \
    --host "$all_models_router_host" \
    --port "$all_models_router_port" \
    --flash-attn on \
    --ctx-size "$all_models_context_size" \
    --cache-type-k q8_0 \
    --cache-type-v q8_0 \
    --cache-ram 12288 \
    --parallel 1 \
    --temp 0.7 \
    --top-p 0.95 \
    --top-k 20 \
    --min-p 0 \
    --reasoning-budget 0 \
    --models-max 1 \
    --sleep-idle-seconds "$all_models_sleep_idle_seconds" \
    --chat-template-kwargs '{"enable_thinking":false}' \
    --jinja \
    --no-mmproj \
    --n-gpu-layers all \
    "$@"
