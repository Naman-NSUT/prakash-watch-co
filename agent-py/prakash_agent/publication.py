"""Keep catalogue publication state aligned with its hard requirements.

Review flags remain attached to each artifact so the stock room can see what the
agent is still improving. A valid selling price is the one publication gate:
without it checkout cannot quote the customer, so the watch belongs in review.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .artifact import rebuild_index
from .config import AgentConfig
from .models import WatchProduct
from .util import now_iso, read_json, write_json


def publish_all(config: AgentConfig) -> dict[str, Any]:
    """Legacy migration: publish warnings, while retaining hard price holds."""
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
        if product.price.selling is None or product.price.selling <= 0:
            continue
        product.status = "ready"
        product.meta.updated_at = now_iso()
        write_json(path, product.dump())
        published += 1

    if published:
        rebuild_index(config)
    return {"checked": checked, "published": published}


def hold_unpriced(config: AgentConfig) -> dict[str, Any]:
    """Move every unpriced legacy artifact into the admin review queue.

    This is deliberately idempotent so startup may retry it safely. A manually
    unpublished priced watch stays unpublished; this function only enforces the
    missing-price gate and tidies the matching flag and note.
    """
    checked = held = updated = 0
    required_note = "A valid selling price is required before publication."

    for path in sorted(Path(config.data_dir).glob("*.json")):
        if path.name == "index.json":
            continue
        raw = read_json(path)
        if not isinstance(raw, dict):
            continue
        checked += 1
        try:
            product = WatchProduct.model_validate(raw)
        except Exception:  # A malformed artifact already cannot be published.
            continue

        changed = False
        missing = product.price.selling is None or product.price.selling <= 0
        flags = list(product.review.flags)
        notes = [
            note for note in product.review.notes
            if "listing shows 'price on request'" not in note
        ]
        if notes != list(product.review.notes):
            changed = True

        if missing:
            if "no-price" not in flags:
                flags.append("no-price")
                changed = True
            if required_note not in notes:
                notes.append(required_note)
                changed = True
            if product.status == "ready":
                product.status = "needs_review"
                held += 1
                changed = True
        else:
            if "no-price" in flags:
                flags = [flag for flag in flags if flag != "no-price"]
                changed = True
            without_price_notes = [
                note for note in notes
                if "valid selling price" not in note
                and "held for review until" not in note
            ]
            if without_price_notes != notes:
                notes = without_price_notes
                changed = True

        if changed:
            product.review.flags = flags  # type: ignore[assignment]
            product.review.notes = notes
            product.meta.updated_at = now_iso()
            write_json(path, product.dump())
            updated += 1

    if updated:
        rebuild_index(config)
    return {"checked": checked, "held": held, "updated": updated}
