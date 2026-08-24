"""The brand memory base.

A JSON file of official brand websites that the agent reads before every run and
writes back to after it. Photography is taken from these sites: the brand shot
the watch, so nobody else's picture is going to be better.

When a brand the shop has never stocked appears in a sheet, the agent looks its
official site up once, checks the site will actually answer an automated reader,
records what it found, and never has to look again.

That last check matters more than it sounds. Several watch brands refuse bots
outright — every Casio domain tested (casio.com/intl, casio.com/in and
gshock.casio.com) answers 403, as does titan.co.in. Recording that fact is the
difference between falling back gracefully and shipping a listing with no
photograph at all.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .brands import BRANDS, brand_site
from .util import now_iso


@dataclass
class BrandRecord:
    """What the agent knows about one brand's official web presence."""

    brand: str
    domains: list[str] = field(default_factory=list)
    urls: list[str] = field(default_factory=list)
    #: Verified to refuse automated readers, so images must come from elsewhere.
    blocks_bots: bool = False
    #: "seed" for the shipped list, "discovered" for anything found on the fly.
    origin: str = "seed"
    checked_at: str = ""
    note: str = ""

    def hosts(self) -> list[str]:
        return [domain.split("/")[0].removeprefix("www.") for domain in self.domains]


class BrandRegistry:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.records: dict[str, BrandRecord] = {}
        self._dirty = False
        self.load()

    # --- persistence -------------------------------------------------------

    def load(self) -> None:
        raw: list[dict[str, Any]] = []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = []

        for entry in raw:
            if not isinstance(entry, dict) or not entry.get("brand"):
                continue
            record = BrandRecord(
                brand=str(entry["brand"]),
                domains=list(entry.get("domains") or []),
                urls=list(entry.get("urls") or []),
                blocks_bots=bool(entry.get("blocksBots")),
                origin=str(entry.get("origin") or "seed"),
                checked_at=str(entry.get("checkedAt") or ""),
                note=str(entry.get("note") or ""),
            )
            self.records[record.brand.lower()] = record

        # Seed anything shipped with the agent that the file does not have yet, so
        # a brand the shop already stocks never needs discovering.
        for name, site in BRANDS.items():
            if name in self.records:
                continue
            self.records[name] = BrandRecord(
                brand=name,
                domains=list(site.domains),
                urls=list(site.urls),
                blocks_bots=site.blocks_bots,
                origin="seed",
                checked_at="",
                note="Shipped with the agent." + (" Refuses automated readers." if site.blocks_bots else ""),
            )
            self._dirty = True

    def save(self) -> None:
        if not self._dirty:
            return
        payload = [
            {
                "brand": record.brand,
                "domains": record.domains,
                "urls": record.urls,
                "blocksBots": record.blocks_bots,
                "origin": record.origin,
                "checkedAt": record.checked_at,
                "note": record.note,
            }
            for record in sorted(self.records.values(), key=lambda r: r.brand)
        ]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        self._dirty = False

    # --- lookup ------------------------------------------------------------

    def get(self, brand: str) -> BrandRecord | None:
        key = brand.strip().lower()
        if key in self.records:
            return self.records[key]
        # Fall back to the alias table so "G-Shock" resolves to Casio.
        site = brand_site(brand)
        if site:
            for record in self.records.values():
                if record.domains and record.domains[0] in site.domains:
                    return record
        return None

    def official_hosts(self, brand: str) -> list[str]:
        record = self.get(brand)
        return record.hosts() if record else []

    def add(self, record: BrandRecord) -> None:
        self.records[record.brand.lower()] = record
        self._dirty = True


DISCOVERY_SCHEMA = {
    "name": "official_site",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["domain", "url", "confidence", "reason"],
        "properties": {
            "domain": {
                "type": ["string", "null"],
                "description": "Bare domain of the brand's own website, e.g. 'seikowatches.com'. Never a retailer.",
            },
            "url": {"type": ["string", "null"], "description": "Best entry URL on that site, e.g. its watches section."},
            "confidence": {"type": "number", "description": "0 to 1 that this really is the brand's own site."},
            "reason": {"type": "string", "description": "One short sentence."},
        },
    },
}


async def discover(brand: str, llm, http) -> BrandRecord | None:
    """Finds and verifies a brand's official website, once.

    The search result is only half the job: the site is then fetched to see
    whether it will answer an automated reader at all, because a domain that
    returns 403 is worse than useless — it would silently starve every listing
    for that brand of photographs.
    """
    search = await llm.search(f"{brand} watches official website", 6)
    candidates = "\n".join(f"- {c['url']}" for c in search["citations"][:8]) or "(no results)"

    data, _cost = await llm.chat_json(
        model=llm.search_model,
        max_tokens=600,
        schema=DISCOVERY_SCHEMA,
        messages=[
            {
                "role": "system",
                "content": (
                    "You identify a watch brand's own website. Retailers, marketplaces, fan sites and news "
                    "outlets are never the answer. If none of the results is the brand's own site, return null."
                ),
            },
            {"role": "user", "content": f"Brand: {brand}\n\nSearch results:\n{candidates}"},
        ],
    )

    domain = (data.get("domain") or "").strip().lower().removeprefix("www.")
    url = (data.get("url") or "").strip()
    if not domain or float(data.get("confidence") or 0) < 0.5:
        return None

    # Verify it answers us before trusting it for photography.
    probe = url or f"https://www.{domain}/"
    fetched = await http.get_html(probe)
    blocks = fetched is None

    return BrandRecord(
        brand=brand.lower(),
        domains=[domain],
        urls=[probe],
        blocks_bots=blocks,
        origin="discovered",
        checked_at=now_iso(),
        note=(
            f"Discovered automatically. {data.get('reason', '')}".strip()
            + (" Refuses automated readers, so images fall back to other sources." if blocks else "")
        ),
    )


async def ensure(brand: str, registry: BrandRegistry, llm, http, on_stage=None) -> BrandRecord | None:
    """Returns what we know about a brand, discovering it the first time we see it."""
    known = registry.get(brand)
    if known:
        return known

    if on_stage:
        on_stage("brand", f"unknown brand — finding {brand}'s official site")
    record = await discover(brand, llm, http)
    if record is None:
        # Remember the miss too, so every row of the sheet does not re-search.
        record = BrandRecord(
            brand=brand.lower(),
            origin="discovered",
            checked_at=now_iso(),
            note="No official site could be identified; images come from other sources.",
        )
    registry.add(record)
    if on_stage:
        detail = ", ".join(record.domains) if record.domains else "none found"
        on_stage("brand", f"official site: {detail}{' (blocks bots)' if record.blocks_bots else ''}")
    return record
