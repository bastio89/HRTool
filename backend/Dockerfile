FROM node:18-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update && \
  apt-get install -y --no-install-recommends python3 make g++ && \
  rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

FROM node:18-bookworm-slim
WORKDIR /app

RUN groupadd --system appuser && \
  useradd --system --create-home --gid appuser appuser

RUN apt-get update && \
  apt-get install -y --no-install-recommends tesseract-ocr poppler-utils ca-certificates && \
  rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV PORT=3001
ENV TESSERACT_BIN=/usr/bin/tesseract
ENV PDFTOPPM_BIN=/usr/bin/pdftoppm

RUN mkdir -p /app/data && \
  chown -R appuser:appuser /app /app/data

VOLUME ["/app/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const port = process.env.PORT || 3001; const url = 'http://127.0.0.1:' + port + '/api/health'; fetch(url).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER appuser
CMD ["node", "server.js"]
