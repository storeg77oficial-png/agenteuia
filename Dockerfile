FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "cd backend && npm run migrate && npm start"]
