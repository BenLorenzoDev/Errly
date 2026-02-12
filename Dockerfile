# Stage 1: Build
FROM node:20-alpine AS build

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY src/ src/
COPY tsconfig.json tsconfig.client.json vite.config.ts drizzle.config.ts postcss.config.js ./

# Build: generate migrations, build client, compile server
RUN npm run build

# Prune dev dependencies (keep compiled native modules)
RUN npm prune --omit=dev

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy production node_modules with compiled native modules from build stage
COPY --from=build /app/node_modules/ node_modules/

# Copy package.json (needed for Node.js module resolution)
COPY --from=build /app/package.json ./

# Copy compiled server from build stage
COPY --from=build /app/dist/server/ dist/server/

# Copy built client from build stage
COPY --from=build /app/dist/client/ dist/client/

# Copy drizzle migrations from build stage
COPY --from=build /app/drizzle/ drizzle/

# Create data directory for SQLite volume mount
RUN mkdir -p /data

# Set environment defaults
ENV ERRLY_DB_PATH=/data/errly.db
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
