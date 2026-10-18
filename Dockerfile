FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# The web app, served by the API from the same origin (src/api/web.ts).
FROM node:24-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
# The spec's GPS adapter lives in the backend tree; keep its relative path for the web's Vite alias.
COPY src/phone-observations /app/src/phone-observations
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /app/web/dist ./web/dist
COPY package.json package-lock.json ./
COPY db ./db
COPY public ./public
COPY scripts/migrate.mjs scripts/bootstrap.mjs scripts/seed-demo.mjs ./scripts/
COPY infra/rds-global-bundle.pem ./infra/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
