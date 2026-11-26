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
COPY apps/api/package.json apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/prisma/src ./packages/prisma/src
COPY packages/types/src ./packages/types/src
COPY packages/whatsapp/src ./packages/whatsapp/src
COPY apps/api/src ./apps/api/src

RUN pnpm --filter @speediator/prisma exec tsc -p tsconfig.json \
 && pnpm --filter @speediator/types exec tsc -p tsconfig.json \
 && pnpm --filter @speediator/whatsapp exec tsc -p tsconfig.json \
 && pnpm --filter @speediator/api build

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

COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

EXPOSE 3001

CMD ["pnpm", "--filter", "@speediator/api", "start"]
