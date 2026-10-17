FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY db ./db
COPY scripts/migrate.mjs scripts/bootstrap.mjs ./scripts/
COPY infra/rds-global-bundle.pem ./infra/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
