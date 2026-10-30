"""Move legacy automated review decisions back onto the storefront.

Review flags remain attached to each artifact so the stock room can see what the
agent is still improving. Only visibility changes. Later manual unpublishes are
left alone because this migration is marked and runs once.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .artifact import rebuild_index
from .config import AgentConfig
from .models import WatchProduct
from .util import now_iso, read_json, write_json


def publish_all(config: AgentConfig) -> dict[str, Any]:
    checked = published = 0
    for path in sorted(Path(config.data_dir).glob("*.json")):
        if path.name == "index.json":
            continue
        raw = read_json(path)
        if not isinstance(raw, dict):
            continue
        checked += 1
        try:
            product = WatchProduct.model_validate(raw)
        except Exception:  # A malformed artifact stays off the shop.
            continue
        if product.status == "failed" or product.status == "ready":
            continue
        product.status = "ready"
        product.meta.updated_at = now_iso()
        write_json(path, product.dump())
        published += 1

    if published:
        rebuild_index(config)
    return {"checked": checked, "published": published}
