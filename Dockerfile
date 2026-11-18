# Start the bot. Any container host works — Render, Fly, Koyeb.
# DB_PATH points at the persistent volume so SQLite survives redeploys.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
ENV DB_PATH=/data/ascend.db

CMD ["npm", "start"]
