# Production Dockerfile for Flux Performance Dashboard
# Runs both Express API (port 3000) and SvelteKit Frontend (port 5173)

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for better-sqlite3 and runtime utilities
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    sqlite-dev \
    pkgconfig \
    build-base \
    curl \
    wget

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies with proper environment for better-sqlite3
ENV PYTHON=/usr/bin/python3
RUN npm install --legacy-peer-deps

# Rebuild better-sqlite3 for Alpine Linux
RUN npm rebuild better-sqlite3

# Copy source code
COPY . .

# Build the SvelteKit frontend for production
RUN npm run build

# Copy startup script
COPY startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S fluxapp -u 1001

# Create data directory for SQLite database with proper permissions
RUN mkdir -p /app/data && chown -R fluxapp:nodejs /app/data

# Create database directory for better-sqlite3
RUN mkdir -p /app/src/lib/db && chown -R fluxapp:nodejs /app/src/lib/db

# Set ownership of the application
RUN chown -R fluxapp:nodejs /app

# Switch to non-root user
USER fluxapp

# Set production environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# ========================================
# PORT CONFIGURATION - CRITICAL FIX
# ========================================
# IMPORTANT: We need separate variables because server.js reads PORT
# Backend API port (Express server) - Don't use "PORT" here!
ENV API_PORT=3000

# Frontend port (SvelteKit) - This is what build/index.js will use
ENV FRONTEND_PORT=5173

# CORS origin (update this for production)
ENV ORIGIN=http://localhost:5173

# ========================================
# EXPOSE PORTS
# ========================================
# API port
EXPOSE 3000
# Frontend port
EXPOSE 5173

# Health check for the API server
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start both services using the startup script
CMD ["/app/startup.sh"]