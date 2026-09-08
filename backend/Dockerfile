FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-reportlab python3-certifi make g++ tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY backend/server.js ./server.js
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY batch_tools ./batch_tools
COPY backend_new ./backend_new

RUN mkdir -p data/uploads data/tmp

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
