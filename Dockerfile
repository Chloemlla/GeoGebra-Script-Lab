FROM node:24-alpine AS frontend-build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile

COPY index.html vite.config.js ./
COPY src ./src
COPY icon ./icon

ARG VITE_BASE_PATH=/
ARG VITE_API_BASE_URL=
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm build

FROM rust:1.89-bookworm AS backend-build

WORKDIR /app/backend

COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src

RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=backend-build /app/backend/target/release/geograba-backend /usr/local/bin/geograba-backend

ENV BIND_ADDR=0.0.0.0:8080 \
    API_BASE_URL=http://localhost:8080 \
    MONGODB_URI= \
    MONGODB_DATABASE=geograba \
    MODEL_BASE_URL=https://api.openai.com/v1 \
    MODEL_NAME=gpt-4.1-mini

EXPOSE 8080

FROM runtime-base AS backend-runtime

CMD ["geograba-backend"]

FROM runtime-base AS fullstack-runtime

COPY --from=frontend-build /app/dist ./frontend-dist

ENV FRONTEND_DIST_DIR=/app/frontend-dist

CMD ["geograba-backend"]

FROM fullstack-runtime AS runtime

CMD ["geograba-backend"]
