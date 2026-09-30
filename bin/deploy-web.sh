#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun run --filter @anora/web manifest
bun run --filter @anora/web build
rsync -a --delete apps/web/dist/ /srv/anora-openhouse/
echo "deployed to https://openhouse.anora.finance"
