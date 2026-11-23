FROM node:26-alpine AS base


FROM base AS deps

RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src


RUN npm run build

# Production-only dependency tree for the runtime image: the full tree from
# `deps` is needed to compile, but shipping it would carry the toolchain
# (eslint, vitest, semantic-release and their transitive advisories) into prod.
FROM base AS prod-deps

RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Europe/Moscow

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build

EXPOSE 3000

CMD ["node", "build/index.js"]
