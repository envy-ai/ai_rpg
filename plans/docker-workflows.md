# Docker GitHub Actions Workflows

This document describes the GitHub Actions workflows used for building and publishing Docker images to the GitHub Container Registry (ghcr.io).

## Overview

Two workflows handle Docker image building and publishing:

1. **[`docker-ci.yml`](.github/workflows/docker-ci.yml)** - Builds images on push to main/master and pull requests
2. **[`docker-release.yml`](.github/workflows/docker-release.yml)** - Builds and publishes images on version tags

## Container Registry

Images are published to GitHub Container Registry using the `ghcr.io` registry. The image name follows the pattern:

```
ghcr.io/<owner>/<repository-name>
```

For example: `ghcr.io/ocyris/ai-rpg`

## Workflows

### CI Workflow (`docker-ci.yml`)

**Trigger Events:**
- Push to `main` or `master` branches
- Pull requests targeting `main` or `master`

**Behavior:**

| Event | Action |
|-------|--------|
| Push to main/master | Builds and pushes image with tags: `latest`, `sha-<commit>`, `<branch>` |
| Pull request | Builds image (no push) with tags: `pr-<number>`, `sha-<commit>` |

**Key Features:**
- Uses Docker Buildx with GitHub Actions cache for faster builds
- Uses `GITHUB_TOKEN` for authentication (no manual secrets needed)
- Sets appropriate permissions for package write access

### Release Workflow (`docker-release.yml`)

**Trigger Events:**
- Push of any tag matching pattern `v*.*.*` (e.g., `v1.0.0`, `v2.3.5`)

**Behavior:**
- Builds and pushes image with tags: `<version>`, `latest`, `sha-<commit>`

**Key Features:**
- Uses semantic version from the tag
- Always pushes to registry (not a dry-run)
- Same build optimizations as CI workflow

## Tagging Strategy

| Event | Tags Applied |
|-------|--------------|
| Push to main | `latest`, `sha-<short-sha>`, `<branch>` |
| Pull request | `pr-<number>`, `sha-<short-sha>` |
| Version tag (e.g., `v1.0.0`) | `1.0.0`, `latest`, `sha-<short-sha>` |

## Usage

### For CI

Simply push to main or create a pull request:

```bash
git checkout -b feature/my-feature
git commit -m "Add new feature"
git push origin feature/my-feature
# Create PR via GitHub UI
```

The workflow will automatically:
- Build the Docker image
- Push to ghcr.io (on main push only)

### For Releases

Tag a version using semantic versioning:

```bash
# Update version in package.json first (optional, for reference)
git tag v1.0.0
git push origin v1.0.0
```

This will:
- Build the Docker image
- Push with tags `v1.0.0`, `1.0.0`, `latest`, and the commit SHA

## Running Images

After a successful build, you can pull and run the image:

```bash
# Login to ghcr.io (if not already)
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull the image
docker pull ghcr.io/ocyris/ai-rpg:latest

# Run with environment variables
docker run -d \
  -p 7777:7777 \
  -e AI_ENDPOINT=https://api.openai.com/v1 \
  -e AI_API_KEY=your-api-key \
  ghcr.io/ocyris/ai-rpg:latest
```

Or using docker-compose:

```yaml
services:
  ai-rpg:
    image: ghcr.io/ocyris/ai-rpg:latest
    ports:
      - "7777:7777"
    environment:
      AI_ENDPOINT: "${AI_ENDPOINT}"
      AI_API_KEY: "${AI_API_KEY}"
    volumes:
      - ./config:/app/config
```

## Workflow File Locations

- CI: [`.github/workflows/docker-ci.yml`](.github/workflows/docker-ci.yml)
- Release: [`.github/workflows/docker-release.yml`](.github/workflows/docker-release.yml)