# Neuma — Multi-stage Docker build
# Stage 1: Build frontend with Vite
# Stage 2: Production runtime (backend + neuma engine + built frontend)

# --- Build stage ---
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/ ./frontend/
COPY vite.config.js ./
RUN npm run build

# --- Production stage ---
FROM node:22-slim
WORKDIR /app

# System deps for onnxruntime-node (native bindings need glibc, already in slim)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application code — engine lives in core/ (not the retired neuma/ path)
COPY backend/ ./backend/
COPY core/ ./core/
# Chain-reader ABIs (docs/ otherwise dockerignored)
COPY docs/contracts/abis/ ./docs/contracts/abis/

# Frontend assets served by Express in production
COPY frontend/assets/ ./frontend/assets/
COPY frontend/components/ ./frontend/components/
COPY frontend/public/ ./frontend/public/
COPY frontend/styles/ ./frontend/styles/
COPY frontend/utils/ ./frontend/utils/

# Built frontend from stage 1
COPY --from=build /app/dist ./dist/

# Deploy utilities
COPY deploy/ ./deploy/

# Create writable directories (will be volume-mounted in production)
RUN mkdir -p workspaces vault/dna/active vault/dna/history vault/audit \
    data/temp data/dna-cache data/memory-store data/marketplace uploads

# Run as non-root user
RUN groupadd --system neuma && useradd --system --gid neuma neuma
RUN chown -R neuma:neuma /app
USER neuma

ENV NODE_ENV=production
ENV PORT=3333
EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://localhost:3333/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "backend/server.js"]
