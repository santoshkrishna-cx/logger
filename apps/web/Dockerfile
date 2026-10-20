FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm install --workspace @tradelog/web --include-workspace-root=false --no-audit --no-fund && npm run build --workspace @tradelog/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
