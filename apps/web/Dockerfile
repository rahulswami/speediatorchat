FROM node:22-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate

WORKDIR /app

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml pnpm.yaml .npmrc tsconfig.base.json turbo.json ./
COPY packages/prisma/package.json ./packages/prisma/
COPY packages/prisma/prisma ./packages/prisma/prisma/
COPY packages/types/package.json packages/types/tsconfig.json ./packages/types/
COPY packages/whatsapp/package.json ./packages/whatsapp/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/next.config.mjs apps/web/tailwind.config.ts apps/web/postcss.config.mjs apps/web/next-env.d.ts ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/types/src ./packages/types/src
COPY apps/web/src ./apps/web/src

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter @speediator/types exec tsc -p tsconfig.json \
 && pnpm --filter @speediator/web build

FROM base AS runner

ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm.yaml /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/node_modules ./packages/types/node_modules

EXPOSE 3000

CMD ["pnpm", "--filter", "@speediator/web", "start"]
