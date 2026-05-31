# Stage 1: Build the frontend and install dependencies
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for native node addons (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json vite.config.ts index.html ./
RUN npm ci

# Copy source files and build
COPY assets/ ./assets
COPY src/ ./src
RUN npm run build

# Stage 2: Production runner
FROM node:20-alpine
WORKDIR /app

# Install runtime dependencies for better-sqlite3 if needed
RUN apk add --no-cache libc6-compat

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/shelflife.db
ENV SYNC_INTERVAL=300

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy runtime dependencies and server files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY server.ts tsconfig.json ./

# Create data directory for SQLite persistent volume
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Run the TypeScript-based Express server using tsx
CMD ["npx", "tsx", "server.ts"]
