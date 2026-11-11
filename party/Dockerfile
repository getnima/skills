# Party Arena: one container = the realtime game server + the built client.
# Cloud Run sets PORT (8080); locally:  docker run --rm -p 8080:8080 party-arena

# ── 1. build client (vite) + server bundle (esbuild) ──
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Build-time client switches (see README "Tuning"). `docker build --build-arg
# VITE_PLOTZEL_MODE=builtin`, or deploy/.build-env written by cloudrun-deploy.sh.
ARG VITE_PLOTZEL_MODE=
ARG VITE_PLOTZEL_URL=
ARG VITE_PUBLIC_URL=
# Same-origin build: this server serves the client, so no VITE_SERVER_URL.
ENV VITE_SERVER_URL=
RUN if [ -f deploy/.build-env ]; then set -a; . deploy/.build-env; set +a; fi; \
    npm run build && rm -rf deploy

# ── 2. production dependencies only (the server bundle keeps packages external) ──
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── 3. runtime ──
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# The image's built-in unprivileged user (uid 1000).
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server/index.mjs"]
