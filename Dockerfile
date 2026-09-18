# syntax=docker/dockerfile:1
#
# The shop's back end: the Next.js site (admin panel, APIs, photographs) and the
# Python research agent, in one container sharing one disk.
#
# They share a container rather than running as two services because a Render
# disk attaches to exactly one service, and both of them read and write it: the
# agent writes listings and photographs, the site reads them and records every
# sale, repair ticket and edit against the same files.

# ---------------------------------------------------------------------------
# Stage 1 — build the site
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS web-build
WORKDIR /build/nextjs
ENV NEXT_TELEMETRY_DISABLED=1

COPY nextjs/package.json nextjs/package-lock.json ./
RUN npm ci

COPY nextjs/ ./
# The build reads no shop data — every page that shows stock reads the disk at
# request time — so it needs no volume and no secrets.
RUN npm run build \
 && cp -r public .next/standalone/ \
 && cp -r .next/static .next/standalone/.next/

# ---------------------------------------------------------------------------
# Stage 2 — the agent's Python environment
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS agent-build
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY agent-py/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm

# tini reaps the agent's children and forwards a shutdown to the whole group,
# so a deploy stops the agent cleanly instead of killing it mid-write.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The same Node that built the site. Both images are Debian bookworm, so the
# binary and sharp's native module find the glibc they were built against.
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=agent-build /opt/venv /opt/venv

WORKDIR /app
COPY --from=web-build /build/nextjs/.next/standalone ./web
COPY agent-py/ ./agent
# Configuration that ships with the code, copied onto the disk on first boot.
COPY nextjs/data/backdrops.json nextjs/data/brands.json ./seed/
COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV PATH=/opt/venv/bin:$PATH \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PYTHONUNBUFFERED=1 \
    # Everything the shop writes goes to the mounted disk. Nothing under /app
    # outside this path survives a deploy.
    PWC_DATA_ROOT=/app/data \
    AGENT_CACHE_DIR=/app/data/.cache \
    AGENT_SERVICE_URL=http://127.0.0.1:8077 \
    HOSTNAME=0.0.0.0 \
    PORT=10000

EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/app/entrypoint.sh"]
