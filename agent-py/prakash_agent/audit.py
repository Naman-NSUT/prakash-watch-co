"""Re-judging what is already published against the house's order of trust.

The hierarchy arrived after most of the catalogue was built, so listings went up
under the older, looser rule: one vouched source anywhere excused everything,
and photographs were never examined at all. This walks the whole catalogue,
records the current decision on every source, and withdraws live listings whose
weakest source fails it.

Withdrawing is not deleting. The listing keeps its research, its photographs and
its price; it moves to the review queue with the hosts that disqualified it named
in its notes, and the shop can publish it with one click after looking.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .artifact import artifact_path, rebuild_index
from .brands import is_indian_url
from .config import AgentConfig
from .trust import host_of, tier
from .util import read_json, write_json


def evidence_urls(product: dict) -> list[str]:
    """Every valid page URL this artifact says it relies on."""
    urls: list[str] = []
    for source in product.get("sources") or []:
        if isinstance(source, dict) and isinstance(source.get("url"), str) and source["url"]:
            urls.append(source["url"])
    for image in product.get("images") or []:
        if isinstance(image, dict) and isinstance(image.get("sourcePage"), str) and image["sourcePage"]:
            urls.append(image["sourcePage"])
    return urls


def judge_listing(product: dict) -> list[str]:
    """The hosts this listing leans on that are neither the brand nor a dealer."""
    brand = product.get("brand") or ""
    bad: list[str] = []
    for url in evidence_urls(product):
        if tier(url, brand) == 3:
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
    entries = [entry for entry in index if isinstance(entry, dict) and entry.get("sku")]

    withdrawn: list[dict] = []
    flagged = 0
    classified = 0
    updated = 0
    tiers = {1: 0, 2: 0, 3: 0}

    for entry in entries:
        path = artifact_path(config, entry["sku"])
        product = read_json(path)
        if not product:
            continue

        brand = product.get("brand") or ""
        changed = False

        # Backfill provenance on every existing page. The URL was always kept;
        # these fields make the decision visible without researching the watch
        # again or spending model credit.
        for source in product.get("sources") or []:
            if not isinstance(source, dict) or not source.get("url"):
                continue
            source_tier = tier(source["url"], brand)
            indian = is_indian_url(source["url"], brand)
            if source.get("trustTier") != source_tier or source.get("indianListing") != indian:
                source["trustTier"] = source_tier
                source["indianListing"] = indian
                classified += 1
                changed = True

        strangers = judge_listing(product)
        weakest = max(
            (tier(url, brand) for url in evidence_urls(product)),
            default=3,
        )
        tiers[weakest] = tiers.get(weakest, 0) + 1

        if strangers:
            flagged += 1
            review = product.setdefault("review", {})
            flags = review.setdefault("flags", [])
            if "unverified-source" not in flags:
                flags.append("unverified-source")
                changed = True
            notes = review.setdefault("notes", [])
            note = "Not vouched for: " + ", ".join(strangers[:6])
            if note not in notes:
                notes.append(note)
                changed = True

            if product.get("status") == "ready":
                product["status"] = "needs_review"
                changed = True
                withdrawn.append({"sku": product["sku"], "brand": brand, "hosts": strangers})
                if on_each:
                    on_each(product["sku"], strangers)

        if commit and changed:
            write_json(path, product)
            updated += 1

    if commit and updated:
        rebuild_index(config)

    return {
        "checked": len(entries),
        "classified": classified,
        "updated": updated,
        "flagged": flagged,
        "withdrawn": withdrawn,
        "worst_tier": tiers,
    }
