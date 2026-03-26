#!/bin/bash
set -euo pipefail

WORKDIR=/app
CONFIG_DIR=${WORKDIR}/config
TARGET_CONFIG=${CONFIG_DIR}/config.yaml
TEMPLATE_CONFIG=${WORKDIR}/defaults/config.template.yaml

if [ ! -f "$TARGET_CONFIG" ]; then
  cp "$TEMPLATE_CONFIG" "$TARGET_CONFIG"
fi

cp -r "${WORKDIR}/defaults/imagegen" "/app/imagegen"

# Allow env vars to override the generated config, but leave defaults otherwise.
node /app/scripts/docker-config-env.js "${CONFIG_DIR}/config.yaml"

# Server won't start without a config file, so ensure it exists even if env vars are missing.
cp "$TEMPLATE_CONFIG" "$WORKDIR/config.yaml"

exec npm start -- --config-override "${CONFIG_DIR}/config.yaml"
