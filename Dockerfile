FROM node:18-bullseye-slim

WORKDIR /app

# Install build dependencies for npm (sharp, etc.)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 git curl gettext-base && \
    rm -rf /var/lib/apt/lists/*

# Copy package metadata and install dependencies only once
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy the rest of the source tree
COPY . .

# Ensure config directories exist
RUN mkdir -p config logs saves imagegen

# Copy template config to target location if none exists at runtime
RUN cp config.default.yaml config/config.template.yaml

RUN chmod +x scripts/docker-entrypoint.sh scripts/docker-config-env.js

ENV NODE_ENV=production
ENV PORT=7777

EXPOSE 7777

VOLUME ["/app/config","/app/logs","/app/saves","/app/imagegen"]

CMD ["/bin/sh", "-c", "./scripts/docker-entrypoint.sh"]
