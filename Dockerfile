
    FROM oven/bun:1-slim AS builder

    WORKDIR /app
    
    COPY package.json bun.lockb ./
    RUN bun install --frozen-lockfile
    
    COPY . .
    RUN bun run build
    
    
    FROM oven/bun:1-slim
    
    WORKDIR /app
    
    ENV NODE_ENV=production
    ENV PORT=4000

    RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
    
    COPY package.json bun.lockb ./
    RUN bun install --production --frozen-lockfile
    
    COPY --from=builder /app/dist ./dist
    
    EXPOSE 4000
    
    HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
      CMD curl -sf http://localhost:4000/health || exit 1
    
    CMD ["bun", "dist/index.js"]
    