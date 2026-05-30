# syntax=docker/dockerfile:1.7
# ---- Build stage: install prod deps only ----
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# ---- Runtime stage: minimal final image ----
FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="serializd-export" \
      org.opencontainers.image.description="Export your serializd.com watch history" \
      org.opencontainers.image.licenses="MIT"

# Non-root user; output dir owned by it so volume mounts work cleanly.
RUN addgroup -S app && adduser -S -G app app && mkdir -p /app/output && chown -R app:app /app
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --chown=app:app src ./src
COPY --chown=app:app package.json ./

USER app

# Volume for outputs — mount with `-v "$(pwd)/output:/app/output"`.
VOLUME ["/app/output"]

ENV SERIALIZD_OUTPUT_DIR=/app/output \
    NODE_ENV=production

ENTRYPOINT ["node", "src/cli.js"]
CMD []
