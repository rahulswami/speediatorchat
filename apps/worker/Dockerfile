FROM node:22-slim AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate

WORKDIR /app

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml pnpm.yaml .npmrc tsconfig.base.json turbo.json ./
COPY packages/prisma/package.json packages/prisma/tsconfig.json ./packages/prisma/
COPY packages/prisma/prisma ./packages/prisma/prisma/
COPY packages/types/package.json packages/types/tsconfig.json ./packages/types/
COPY packages/whatsapp/package.json packages/whatsapp/tsconfig.json ./packages/whatsapp/
COPY apps/worker/package.json apps/worker/tsconfig.json apps/worker/tsconfig.build.json apps/worker/nest-cli.json ./apps/worker/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/prisma/src ./packages/prisma/src
COPY packages/types/src ./packages/types/src
COPY packages/whatsapp/src ./packages/whatsapp/src
COPY apps/worker/src ./apps/worker/src

RUN pnpm --filter @speediator/prisma exec tsc -p tsconfig.json \
 && pnpm --filter @speediator/types exec tsc -p tsconfig.json \
 && pnpm --filter @speediator/whatsapp exec tsc -p tsconfig.json \
 && pnpm --filter @speediator/worker build

FROM base AS runner

ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm.yaml /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/prisma/package.json ./packages/prisma/
COPY --from=builder /app/packages/prisma/prisma ./packages/prisma/prisma
COPY --from=builder /app/packages/prisma/dist ./packages/prisma/dist
COPY --from=builder /app/packages/prisma/node_modules ./packages/prisma/node_modules

COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/node_modules ./packages/types/node_modules

COPY --from=builder /app/packages/whatsapp/package.json ./packages/whatsapp/
COPY --from=builder /app/packages/whatsapp/dist ./packages/whatsapp/dist
COPY --from=builder /app/packages/whatsapp/node_modules ./packages/whatsapp/node_modules

COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules

EXPOSE 3002

CMD ["pnpm", "--filter", "@speediator/worker", "start"]
