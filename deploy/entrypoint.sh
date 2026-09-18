#!/bin/sh
# Starts the shop's back end: the research agent on loopback, then the site.
set -eu

DATA="${PWC_DATA_ROOT:-/app/data}"

# ---------------------------------------------------------------------------
# First boot: the disk arrives empty.
# ---------------------------------------------------------------------------
# An archive left by deploy/upload-data.sh is unpacked before anything else, so
# the shop's real brand registry and backdrops win over the seed copies below.
# Doing it here means an upload needs nothing but scp and a restart — both of
# which Render documents — rather than a remote command over SSH, which it does not.
if [ -f "$DATA/.upload.tar.gz" ]; then
  echo "unpacking the uploaded data archive"
  if tar -xzf "$DATA/.upload.tar.gz" -C "$DATA"; then
    rm -f "$DATA/.upload.tar.gz"
  else
    echo "WARNING: the uploaded archive could not be unpacked; left in place" >&2
  fi
fi

# Seed the configuration that ships with the code — but never overwrite it. Once
# the agent has discovered a new brand's site, or the shop has edited a backdrop,
# the copy on the disk is the real one and the image's copy is merely stale.
mkdir -p "$DATA/catalog" "$DATA/media" "$DATA/runs" "$DATA/uploads" \
         "$DATA/repairs" "$DATA/bills" "$DATA/.cache"
for file in backdrops.json brands.json; do
  if [ ! -f "$DATA/$file" ]; then
    cp "/app/seed/$file" "$DATA/$file"
    echo "seeded $file onto the disk"
  fi
done
# An empty catalogue must still be a valid one, or every shop page errors
# instead of showing "nothing listed yet".
[ -f "$DATA/catalog/index.json" ] || echo "[]" > "$DATA/catalog/index.json"

# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------
# Loopback only. It spends the shop's OpenRouter balance, so nothing outside this
# container may reach it; the site talks to it over 127.0.0.1 with the shared
# token. Restarted if it exits, because the public site does not depend on it and
# must never go down with it.
if [ -z "${AGENT_SERVICE_TOKEN:-}" ]; then
  echo "WARNING: AGENT_SERVICE_TOKEN is not set — the agent will accept any caller on loopback" >&2
fi
(
  cd /app/agent
  while true; do
    uvicorn prakash_agent.server:app --host 127.0.0.1 --port 8077 --log-level warning || true
    echo "agent exited; restarting in 3s" >&2
    sleep 3
  done
) &

# ---------------------------------------------------------------------------
# The site
# ---------------------------------------------------------------------------
cd /app/web
exec node server.js
