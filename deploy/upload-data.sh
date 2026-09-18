#!/bin/sh
# Copies the shop's data from this machine onto the Render disk.
#
#   deploy/upload-data.sh srv-xxxxxxxxxxxx@ssh.singapore.render.com
#
# The address is on the service's page in the Render dashboard, under Connect → SSH.
# Render needs your SSH public key first: Account Settings → SSH Public Keys.
#
# Why this exists: the repository is public, so the shop's data can never travel
# through it. Listings, photographs, repair tickets, bills and the accounts go
# straight from this machine to the disk over SSH, and nowhere else.
#
# Safe to run again. Files on the disk are overwritten by the copies here, and
# anything that exists only on the disk — tickets customers have submitted since
# the last upload — is left alone, because tar only writes what it carries.
set -eu

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 srv-xxxxxxxxxxxx@ssh.<region>.render.com" >&2
  exit 64
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$HERE/../nextjs/data"
[ -d "$DATA/catalog" ] || { echo "no catalogue at $DATA — nothing to upload" >&2; exit 66; }

# mktemp creates the archive readable by this user only. It holds customer
# details, so it is removed however the script ends.
ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/pwc-data.XXXXXX")"
trap 'rm -f "$ARCHIVE"' EXIT INT TERM

echo "packing $(du -sh "$DATA" | cut -f1) from $DATA …"
tar -czf "$ARCHIVE" -C "$DATA" .
echo "archive: $(du -h "$ARCHIVE" | cut -f1)"

# -s uses SFTP, which is what Render's SSH gateway recommends.
echo "copying to $TARGET …"
scp -s "$ARCHIVE" "$TARGET:/app/data/.upload.tar.gz"

# Unpack it now if Render lets a command run over SSH. It does not document that
# it does, so this is attempted, not relied on: the service unpacks any archive it
# finds when it starts, and a restart finishes the job either way.
echo "unpacking on the disk …"
if ssh "$TARGET" 'cd /app/data && tar -xzf .upload.tar.gz && rm -f .upload.tar.gz && echo "listings on the disk: $(ls catalog | grep "\.json$" | grep -vc "^index\.json$")"'; then
  echo "done. The site reads the disk on every request, so nothing needs restarting."
else
  echo
  echo "The archive is on the disk but could not be unpacked remotely."
  echo "Finish it from the Render dashboard: open the service, then Manual Deploy → Restart service."
  echo "On start-up it unpacks /app/data/.upload.tar.gz and removes it."
fi
