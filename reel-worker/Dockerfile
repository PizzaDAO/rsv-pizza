# Railway: set the service's Root Directory to `reel-worker/`. Single replica, concurrency 1.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    ASSETS_DIR=/app/assets
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY assets ./assets
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
