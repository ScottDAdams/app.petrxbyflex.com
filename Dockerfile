FROM node:20-alpine AS builder
WORKDIR /app
# Vite reads env vars at build time. Default empty so getOneIncModalVersion() falls back
# to "legacy" and the production code path is unchanged. To enable the v2 experiment build:
#   flyctl deploy --build-arg VITE_ONEINC_MODAL_VERSION=v2
ARG VITE_ONEINC_MODAL_VERSION=
ENV VITE_ONEINC_MODAL_VERSION=$VITE_ONEINC_MODAL_VERSION
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
