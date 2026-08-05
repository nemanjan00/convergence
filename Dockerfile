# convergence — served app (HTTP API + UI + scheduler).
FROM node:22-slim

# Optional runtime tools a few blocks shell out to (tolerant if absent):
#   exiftool -> exif block · dig -> cli DNS · whois -> cli whois
RUN apt-get update && apt-get install -y --no-install-recommends \
	libimage-exiftool-perl dnsutils whois ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching. --ignore-scripts skips the husky git-hook
# setup (irrelevant in a container).
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-scripts

COPY . .

# Build the live UI (no baked data — it fetches /api/snapshot at runtime).
RUN LIVE_ONLY=1 yarn frontend:build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# The long-running app: API + UI + active-playbook scheduler.
CMD ["node", "src/index.js"]
