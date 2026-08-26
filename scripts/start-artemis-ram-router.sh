#!/usr/bin/env bash
set -euo pipefail

readonly artemis_llama_binary="${ARTEMIS_LLAMA_BINARY:-/home/bart/prism-llama-bonsai-27b/bin-streaming-logprobs-tools/llama-server}"
readonly artemis_source_model="${ARTEMIS_SOURCE_MODEL:-/d/llms/Artemis-31B-v1.Q4_K_S.gguf}"
readonly artemis_shm_models_dir="${ARTEMIS_SHM_MODELS_DIR:-/dev/shm/ai-rpg-artemis-models}"
readonly artemis_model_filename="$(basename -- "$artemis_source_model")"
readonly artemis_staged_model="$artemis_shm_models_dir/$artemis_model_filename"
readonly artemis_stage_fingerprint_file="$artemis_staged_model.source-fingerprint"
readonly artemis_stage_lock_file="$artemis_shm_models_dir/.stage.lock"
readonly artemis_stage_partial_file="$artemis_staged_model.partial"
readonly artemis_stage_fingerprint_partial_file="$artemis_stage_fingerprint_file.partial"
readonly artemis_router_host="${ARTEMIS_LLAMA_HOST:-0.0.0.0}"
readonly artemis_router_port="${ARTEMIS_LLAMA_PORT:-5005}"
readonly artemis_context_size="${ARTEMIS_LLAMA_CTX_SIZE:-96000}"
readonly artemis_sleep_idle_seconds="${ARTEMIS_LLAMA_SLEEP_IDLE_SECONDS:-180}"

if [[ ! -x "$artemis_llama_binary" ]]; then
    printf 'Artemis llama.cpp binary is not executable: %s\n' "$artemis_llama_binary" >&2
    exit 1
fi

if [[ ! -f "$artemis_source_model" || ! -r "$artemis_source_model" ]]; then
    printf 'Artemis source model is not a readable regular file: %s\n' "$artemis_source_model" >&2
    exit 1
fi

for artemis_required_command in findmnt flock stat cp mv rm mkdir; do
    if ! command -v "$artemis_required_command" >/dev/null 2>&1; then
        printf 'Required command is unavailable: %s\n' "$artemis_required_command" >&2
        exit 1
    fi
done

mkdir -p -- "$artemis_shm_models_dir"

readonly artemis_stage_filesystem="$(findmnt -n -o FSTYPE -T "$artemis_shm_models_dir")"
if [[ "$artemis_stage_filesystem" != "tmpfs" ]]; then
    printf 'Artemis staging directory must be on tmpfs, but %s is on %s.\n' \
        "$artemis_shm_models_dir" "$artemis_stage_filesystem" >&2
    exit 1
fi

exec 9>"$artemis_stage_lock_file"
flock -x 9

readonly artemis_source_size="$(stat -c '%s' -- "$artemis_source_model")"
readonly artemis_source_fingerprint="$(stat -c '%d:%i:%s:%y' -- "$artemis_source_model")"

artemis_staged_model_is_current=false
if [[ -f "$artemis_staged_model" && -r "$artemis_stage_fingerprint_file" ]]; then
    artemis_staged_size="$(stat -c '%s' -- "$artemis_staged_model")"
    artemis_recorded_fingerprint="$(<"$artemis_stage_fingerprint_file")"
    if [[ "$artemis_staged_size" == "$artemis_source_size" \
        && "$artemis_recorded_fingerprint" == "$artemis_source_fingerprint" ]]; then
        artemis_staged_model_is_current=true
    fi
fi

if [[ "$artemis_staged_model_is_current" == false ]]; then
    printf 'Staging Artemis in tmpfs: %s -> %s\n' \
        "$artemis_source_model" "$artemis_staged_model"
    artemis_clean_partial_stage() {
        rm -f -- "$artemis_stage_partial_file" "$artemis_stage_fingerprint_partial_file"
    }
    trap artemis_clean_partial_stage EXIT
    rm -f -- "$artemis_stage_partial_file" "$artemis_stage_fingerprint_partial_file"
    cp --reflink=never -- "$artemis_source_model" "$artemis_stage_partial_file"

    artemis_copied_size="$(stat -c '%s' -- "$artemis_stage_partial_file")"
    if [[ "$artemis_copied_size" != "$artemis_source_size" ]]; then
        printf 'Staged Artemis size mismatch: expected %s bytes, copied %s bytes.\n' \
            "$artemis_source_size" "$artemis_copied_size" >&2
        exit 1
    fi

    printf '%s\n' "$artemis_source_fingerprint" >"$artemis_stage_fingerprint_partial_file"
    mv -f -- "$artemis_stage_partial_file" "$artemis_staged_model"
    mv -f -- "$artemis_stage_fingerprint_partial_file" "$artemis_stage_fingerprint_file"
    trap - EXIT
else
    printf 'Using staged Artemis model from tmpfs: %s\n' "$artemis_staged_model"
fi

flock -u 9
exec 9>&-

exec "$artemis_llama_binary" \
    --models-dir "$artemis_shm_models_dir" \
    --host "$artemis_router_host" \
    --port "$artemis_router_port" \
    --flash-attn on \
    --ctx-size "$artemis_context_size" \
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
    --sleep-idle-seconds "$artemis_sleep_idle_seconds" \
    --chat-template-kwargs '{"enable_thinking":false}' \
    --jinja \
    --no-mmproj \
    --n-gpu-layers all \
    "$@"
