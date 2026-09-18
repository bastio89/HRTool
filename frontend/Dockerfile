FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG FRONTEND_APP_VERSION
ENV FRONTEND_APP_VERSION=${FRONTEND_APP_VERSION}

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
