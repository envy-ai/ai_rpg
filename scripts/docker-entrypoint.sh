#!/bin/sh
set -euo pipefail

CONFIG_DIR=/app/config
TARGET_CONFIG=${CONFIG_DIR}/config.yaml
TEMPLATE_CONFIG=/app/config/config.template.yaml

if [ ! -f "$TARGET_CONFIG" ]; then
  cp "$TEMPLATE_CONFIG" "$TARGET_CONFIG"
fi

# Allow env vars to override the generated config, but leave defaults otherwise.
node /app/scripts/docker-config-env.js "$TARGET_CONFIG"

exec npm start -- --config "$TARGET_CONFIG"
