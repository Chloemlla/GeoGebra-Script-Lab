FROM node:20-alpine AS frontend-build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile

COPY index.html vite.config.js ./
COPY src ./src
COPY icon ./icon

ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

RUN pnpm build

FROM rust:1.89-bookworm AS backend-build

WORKDIR /app/backend

COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src

RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=backend-build /app/backend/target/release/geograba-backend /usr/local/bin/geograba-backend
COPY --from=frontend-build /app/dist ./frontend-dist

ENV BIND_ADDR=0.0.0.0:8080 \
    API_BASE_URL=http://localhost:8080 \
    FRONTEND_DIST_DIR=/app/frontend-dist \
    MONGODB_URI= \
    MONGODB_DATABASE=geograba \
    MODEL_BASE_URL=https://api.openai.com/v1 \
    MODEL_NAME=gpt-4.1-mini \
    API_KEY=

EXPOSE 8080

CMD ["geograba-backend"]
