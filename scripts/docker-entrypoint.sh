#!/bin/bash
set -euo pipefail

CONFIG_DIR=/app
TARGET_CONFIG=${CONFIG_DIR}/config/config.yaml
TEMPLATE_CONFIG=/app/defaults/config.template.yaml

if [ ! -f "$TARGET_CONFIG" ]; then
  cp "$TEMPLATE_CONFIG" "$TARGET_CONFIG"
fi

cp -r "${CONFIG_DIR}/defaults/imagegen" "/app/imagegen"

if [[ ! -f "/app/config.yaml" ]]; then
  ln -s "$TARGET_CONFIG" /app/config.yaml
fi
# Allow env vars to override the generated config, but leave defaults otherwise.
node /app/scripts/docker-config-env.js "/app/config.yaml"

exec npm start -- --config "/app/config.yaml"
