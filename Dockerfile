#FROM oven/bun:1-slim AS builder

#WORKDIR /app

#COPY package.json bun.lock ./
#RUN bun install --frozen-lockfile

#COPY . .
#RUN bun run build


#FROM oven/bun:1-slim

#WORKDIR /app

#ENV NODE_ENV=production

#COPY package.json bun.lock ./
#RUN bun install --production --frozen-lockfile

#COPY --from=builder /app/dist ./dist

#EXPOSE 3000

#CMD ["bun", "start"]


FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["bun", "index.ts"]
