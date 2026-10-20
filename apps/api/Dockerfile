FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN npm install --workspace @tradelog/api --include-workspace-root=false --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
