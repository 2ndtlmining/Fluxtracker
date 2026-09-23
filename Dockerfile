# Production Dockerfile for Flux Performance Dashboard
# Multi-stage build — supports both Supabase and SQLite modes
# Runs both Express API (port 3000) and SvelteKit Frontend (port 5173)

# ========================================
# Stage 1: Build
# ========================================
FROM node:20-alpine AS builder

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install exactly what the lockfile pins (issue #312). `npm install` re-resolved every ^range
# on each build -- and .dockerignore excluded the lockfile, so it had nothing to pin to -- so
# an unchanged commit could ship a dependency tree CI never tested. `npm ci` fails instead of
# drifting. Includes better-sqlite3's native compilation.
RUN npm ci

# Copy source code
COPY . .

# Build the SvelteKit frontend for production
RUN npm run build

# Runtime needs production dependencies only (vite, vitest, svelte-check stay behind).
# `ws` is a direct dependency on purpose and survives this -- see CLAUDE.md.
RUN npm prune --omit=dev

# ========================================
# Stage 2: Runtime
# ========================================
FROM node:20-alpine

WORKDIR /app

# Runtime utilities (curl used by startup.sh health check, wget by HEALTHCHECK)
RUN apk add --no-cache curl wget

# Copy pre-compiled node_modules from builder (includes native better-sqlite3)
COPY --from=builder /app/node_modules ./node_modules

# Copy built output from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json

# Copy startup script
COPY startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

# Create data directory for SQLite (used when DB_TYPE=sqlite)
RUN mkdir -p /app/data

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S fluxapp -u 1001

# Set ownership of the application (including data dir)
RUN chown -R fluxapp:nodejs /app

# Switch to non-root user
USER fluxapp

# Set production environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# ========================================
# PORT CONFIGURATION
# ========================================
ENV API_PORT=3000
ENV FRONTEND_PORT=5173
ENV ORIGIN=http://localhost:5173

# DB_TYPE, SUPABASE_*, and BOOTSTRAP_R2_* env vars are passed at runtime
# via docker run -e or Flux app spec

# ========================================
# EXPOSE PORTS
# ========================================
EXPOSE 3000
EXPOSE 5173

# Liveness check -- both processes, not DB connectivity (issue #309). The probe goes through
# the FRONTEND's /api proxy, so it only passes when the SvelteKit server is up AND can reach
# the API. It used to probe the API alone, so a dead frontend still reported healthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${FRONTEND_PORT:-5173}/api/health/live" || exit 1

# Start both services using the startup script
CMD ["/app/startup.sh"]
