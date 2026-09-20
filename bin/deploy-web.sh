#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
secret with anora-openhouse -- sh -c 'VITE_ALCHEMY_API_KEY=$ALCHEMY_API_KEY bun run --filter @anora/web build'
rsync -a --delete apps/web/dist/ /srv/anora-openhouse/
echo "deployed to https://openhouse.anora.finance"
