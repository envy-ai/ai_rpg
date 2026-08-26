#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

readonly source_save="saves/2026-08-13T20-42-49-015Z_Monster_Girl_Life_2026-06b-Baato-Herbal_Alchemy_Shop_Exterior-char_2-msrziv5j"
readonly input_file="tmp/lamia-shoes-prose-benchmark-input.txt"
readonly batch_stamp="${BATCH_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
readonly tries="${TRIES:-10}"
readonly port="${PORT:-7778}"
readonly start_at="${START_AT:-}"

models=(
  "G4-MeroMero-31B-uncensored-heretic-GGUF"
  "Gemma-4-Garnet-31B-it-uncensored-heretic-GGUF"
  "gemma-4-31B-it-Mystery-Fine-Tune-HERETIC-UNCENSORED-Thinking-Instruct-GGUF"
  "gemma-4-31B-it-qat-q4_0-uncensored-heretic-GGUF"
  "gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-GGUF"
  "Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M"
)

start_reached=false
if [[ -z "$start_at" ]]; then
  start_reached=true
fi

for model in "${models[@]}"; do
  if [[ "$start_reached" == false ]]; then
    if [[ "$model" != "$start_at" ]]; then
      continue
    fi
    start_reached=true
  fi
  npm run benchmark:prose -- \
    --checkpoint "$model" \
    --base-override config.yaml.qwen-combo-router \
    --save "$source_save" \
    --input-file "$input_file" \
    --tries "$tries" \
    --tinybrain true \
    --halt-after-player-action true \
    --port "$port" \
    --run-id "mizuchi-shoes-${batch_stamp}-${model}-tinybrain-player-action-only"
done

if [[ "$start_reached" == false ]]; then
  printf 'START_AT did not match a configured model: %s\n' "$start_at" >&2
  exit 2
fi
