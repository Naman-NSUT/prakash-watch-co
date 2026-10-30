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
         "$DATA/repairs" "$DATA/bills" "$DATA/.cache" "$DATA/.migrations"
for file in backdrops.json brands.json; do
  if [ ! -f "$DATA/$file" ]; then
    cp "/app/seed/$file" "$DATA/$file"
    echo "seeded $file onto the disk"
  fi
done
# An empty catalogue must still be a valid one, or every shop page errors
# instead of showing "nothing listed yet".
[ -f "$DATA/catalog/index.json" ] || echo "[]" > "$DATA/catalog/index.json"

# Existing artifacts already record every source URL. Classify those URLs under
# the exact same Indian-market policy as new research and retain quality warnings
# for anything that needs stronger evidence. This is local JSON work: no network
# calls, model credit or re-research.
SOURCE_TRUST_MIGRATION="$DATA/.migrations/source-trust-v2.done"
if [ ! -f "$SOURCE_TRUST_MIGRATION" ]; then
  echo "classifying existing catalogue sources"
  if (
    cd /app/agent
    python - <<'PY'
from prakash_agent.audit import run_audit
from prakash_agent.config import load_config

report = run_audit(load_config(), commit=True)
print(
    "source audit complete — "
    f"{report['checked']} checked, {report['classified']} sources classified, "
    f"{report['flagged']} flagged for stronger evidence"
)
PY
  ); then
    date -u +%Y-%m-%dT%H:%M:%SZ > "$SOURCE_TRUST_MIGRATION"
  else
    echo "WARNING: source trust migration failed; it will retry after restart" >&2
  fi
fi

# Older runs used quality flags as publication gates. Keep those flags for the
# stock room, but put every valid artifact back on the website once. A later
# manual "take off the shop" remains respected because this migration is marked.
PUBLICATION_MIGRATION="$DATA/.migrations/warnings-not-review-v1.done"
if [ ! -f "$PUBLICATION_MIGRATION" ]; then
  echo "republishing valid catalogue warnings"
  if (
    cd /app/agent
    python - <<'PY'
from prakash_agent.config import load_config
from prakash_agent.publication import publish_all

report = publish_all(load_config())
print(f"publication migration complete — {report['published']} of {report['checked']} moved live")
PY
  ); then
    date -u +%Y-%m-%dT%H:%M:%SZ > "$PUBLICATION_MIGRATION"
  else
    echo "WARNING: publication migration failed; it will retry after restart" >&2
  fi
fi

# Bring old galleries under the same three-to-five-image target as new rows.
# The network pass runs after the site starts and only reads the recorded Indian
# brand/dealer pages. It keeps warnings current while filling galleries toward
# five. Camera classification follows it so new angles cannot put a caseback
# ahead of the dial. One coordinator owns catalogue writes at a time.
GALLERY_MIGRATION="$DATA/.migrations/gallery-3-to-5-v1.done"
COVER_MIGRATION="$DATA/.migrations/cover-view-v2.done"
if [ ! -f "$GALLERY_MIGRATION" ] || [ ! -f "$COVER_MIGRATION" ]; then
  (
    cd /app/agent
    if [ ! -f "$GALLERY_MIGRATION" ]; then
      # The 512 MB service may kill a long image pass after hundreds of watches.
      # Keep retrying from the catalogue on disk: completed galleries are skipped,
      # so each fresh process carries on with the watches that remain. `nice` keeps
      # the public shop and the admin panel ahead of this background housekeeping.
      while [ ! -f "$GALLERY_MIGRATION" ]; do
        echo "starting three-to-five image catalogue migration"
        if nice -n 10 python -m prakash_agent.topup --target 5; then
          date -u +%Y-%m-%dT%H:%M:%SZ > "$GALLERY_MIGRATION"
          echo "three-to-five image catalogue migration complete"
        else
          echo "WARNING: image catalogue migration stopped; retrying in 30 seconds" >&2
          sleep 30
        fi
      done
    fi

    if [ ! -f "$COVER_MIGRATION" ]; then
      echo "starting cover-view catalogue migration"
      if python -m prakash_agent.cover_audit --apply --concurrency 8; then
        date -u +%Y-%m-%dT%H:%M:%SZ > "$COVER_MIGRATION"
        echo "cover-view catalogue migration complete"
      else
        echo "WARNING: cover-view catalogue migration did not finish; it will resume after restart" >&2
      fi
    fi
  ) &
fi

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
