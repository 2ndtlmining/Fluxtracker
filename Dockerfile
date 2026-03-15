# Production Dockerfile for Flux Performance Dashboard
# Multi-stage build — no native compilation deps in final image
# Runs both Express API (port 3000) and SvelteKit Frontend (port 5173)

# ========================================
# Stage 1: Build
# ========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies (no native deps needed — pure JS + Supabase)
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the SvelteKit frontend for production
RUN npm run build

# ========================================
# Stage 2: Runtime
# ========================================
FROM node:20-alpine

WORKDIR /app

# Runtime utilities (curl used by startup.sh health check, wget by HEALTHCHECK)
RUN apk add --no-cache curl wget

# Copy package files and install production deps only
COPY package*.json ./
RUN npm install --legacy-peer-deps --omit=dev

# Copy built output from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/src ./src

# Copy startup script
COPY startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S fluxapp -u 1001

# Set ownership of the application
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

# Supabase env vars are passed at runtime via docker run -e or Flux app spec
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL

# ========================================
# EXPOSE PORTS
# ========================================
EXPOSE 3000
EXPOSE 5173

# Health check for the API server
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start both services using the startup script
CMD ["/app/startup.sh"]
