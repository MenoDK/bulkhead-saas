# syntax=docker/dockerfile:1.7
# Build context is the repository root (docker-compose.yml), because the landing page lives in ../site.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /web

FROM base AS deps
COPY web/package.json web/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/public ./public
COPY web/src ./src
RUN pnpm build

# nginx-unprivileged runs as a non-root user on 8080 and needs no capabilities.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/security-headers.conf /etc/nginx/snippets/security-headers.conf
# Landing page and lab at the root, the console under /app/.
COPY site /usr/share/nginx/html
COPY --from=build /web/dist /usr/share/nginx/html/app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
