"""Re-judging what is already published against the house's order of trust.

The hierarchy arrived after most of the catalogue was built, so listings went up
under the older, looser rule: one vouched source anywhere excused everything,
and photographs were never examined at all. This walks what is live, applies the
rule as it now stands, and withdraws anything that fails it.

Withdrawing is not deleting. The listing keeps its research, its photographs and
its price; it moves to the review queue with the hosts that disqualified it named
in its notes, and the shop can publish it with one click after looking.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from .artifact import artifact_path, rebuild_index
from .config import AgentConfig
from .trust import host_of, tier
from .util import read_json


def judge_listing(product: dict) -> list[str]:
    """The hosts this listing leans on that are neither the brand nor a dealer."""
    brand = product.get("brand") or ""
    urls = [
        *(s.get("url") for s in (product.get("sources") or [])),
        *(i.get("sourcePage") for i in (product.get("images") or [])),
    ]
    bad: list[str] = []
    for url in urls:
        if url and tier(url, brand) == 3:
            host = host_of(url)
            if host and host not in bad:
                bad.append(host)
    return bad


def run_audit(
    config: AgentConfig,
    *,
    commit: bool = False,
    on_each: Callable[[str, list[str]], None] | None = None,
) -> dict[str, Any]:
    data_dir = Path(config.data_dir)
    index = read_json(data_dir / "index.json") or []
    live = [e for e in index if e.get("status") == "ready"]

    withdrawn: list[dict] = []
    tiers = {1: 0, 2: 0, 3: 0}

    for entry in live:
        path = artifact_path(config, entry["sku"])
        product = read_json(path)
        if not product:
            continue

        strangers = judge_listing(product)
        brand = product.get("brand") or ""
        best = min(
            (tier(u, brand) for u in [
                *(s.get("url") for s in (product.get("sources") or []) if s.get("url")),
                *(i.get("sourcePage") for i in (product.get("images") or []) if i.get("sourcePage")),
            ]),
            default=3,
        )
        tiers[best] = tiers.get(best, 0) + 1

        if not strangers:
            continue

        withdrawn.append({"sku": product["sku"], "brand": brand, "hosts": strangers})
        if on_each:
            on_each(product["sku"], strangers)
        if commit:
            product["status"] = "needs_review"
            review = product.setdefault("review", {})
            flags = review.setdefault("flags", [])
            if "unverified-source" not in flags:
                flags.append("unverified-source")
            notes = review.setdefault("notes", [])
            note = "Withdrawn by the source audit. Not vouched for: " + ", ".join(strangers[:6])
            if note not in notes:
                notes.append(note)
            path.write_text(json.dumps(product, indent=2, ensure_ascii=False) + "\n", "utf-8")

    if commit and withdrawn:
        rebuild_index(config)

    return {"checked": len(live), "withdrawn": withdrawn, "best_tier": tiers}
