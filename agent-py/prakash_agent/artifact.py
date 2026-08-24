"""Artifact assembly.

Turns the research, enrichment and image stages into one validated WatchProduct,
scores how much of it is actually backed by a source, and decides whether a human
needs to look before it goes live.
"""

from __future__ import annotations

import re
from pathlib import Path

from .config import COLLECTIONS, AgentConfig
from .enrich import FACT_GROUPS, FACT_LABELS, to_attributes
from .facets import derive as derive_facets
from .models import (
    Attributes,
    CatalogEntry,
    Confidence,
    Copy,
    Facets,
    FactsResult,
    Meta,
    Price,
    ProductImage,
    Review,
    ScrapedPage,
    SheetRow,
    Source,
    Spec,
    WatchProduct,
)
from .util import format_inr, make_sku, now_iso, read_json, write_json

#: Specifications a shopper expects; used to score how complete a listing is.
CORE_FIELDS = ("movement", "case_material", "case_diameter_mm", "water_resistance", "crystal", "strap_material")

BLOCKING_FLAGS = ("no-sources", "model-mismatch", "no-images", "unverified-copy")


def normalise_gender(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.lower()
    if re.search(r"(^|\W)(men|male|gents?|him)(\W|$)", lowered):
        return "men"
    if re.search(r"(^|\W)(women|female|ladies|lady|her)(\W|$)", lowered):
        return "women"
    if "unisex" in lowered:
        return "unisex"
    return None


#: Words the shop is likely to type in a Collection column, mapped to a family.
HINT_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"smart|hybrid|connected|bluetooth", "connected"),
    (r"solar|eco[- ]?drive|light[- ]powered|kinetic", "solar-eco"),
    (r"chrono|tachymeter", "chronograph"),
    (r"div(e|er)|sport|aqua|sea|marine", "dive-sport"),
    (r"automatic|mechanical|self[- ]winding", "swiss-automatic"),
    (r"dress|quartz|classic|formal", "dress-quartz"),
)


def collection_from_hint(hint: str | None) -> str | None:
    """Maps whatever the shop wrote in its Collection column to a family."""
    if not hint:
        return None
    lowered = hint.lower()
    if lowered in COLLECTIONS:
        return lowered
    for pattern, collection in HINT_PATTERNS:
        if re.search(pattern, lowered):
            return collection
    return None


def infer_collection(stated: str | None, hint: str | None, attributes: Attributes) -> str | None:
    """Chooses the family, preferring what the shop wrote over what was researched."""
    # 1. The sheet is authoritative whenever it says something usable.
    from_hint = collection_from_hint(hint)
    if from_hint:
        return from_hint

    # 2. Otherwise the researched classification.
    if stated and stated in COLLECTIONS:
        return stated

    # 3. Otherwise deduce it from the confirmed specifications.
    haystack = " ".join(
        filter(
            None,
            [
                hint or "",
                attributes.movement or "",
                attributes.bezel or "",
                attributes.water_resistance or "",
                " ".join(attributes.functions),
            ],
        )
    ).lower()

    if re.search(r"smart|hybrid|connected|bluetooth", haystack):
        return "connected"
    if re.search(r"solar|eco[- ]?drive|light[- ]powered|kinetic", haystack):
        return "solar-eco"
    if re.search(r"chronograph|tachymeter", haystack):
        return "chronograph"

    metres_match = re.search(r"(\d+)\s*m\b", attributes.water_resistance or "", re.IGNORECASE)
    metres = int(metres_match.group(1)) if metres_match else 0
    if re.search(r"diver?|rotating bezel|iso 6425", haystack) or metres >= 200:
        return "dive-sport"
    if re.search(r"automatic|mechanical|self[- ]winding", haystack):
        return "swiss-automatic"
    if "quartz" in haystack:
        return "dress-quartz"
    return None


def build_product(
    *,
    row: SheetRow,
    sources: list[Source],
    pages: list[ScrapedPage],
    facts: FactsResult,
    copy: Copy,
    images: list[ProductImage],
    queries: list[str],
    run_id: str,
    source_file: str,
    model: str,
    cost_usd: float,
    backdrop_id: str | None = None,
    extra_flags: list[str] | None = None,
    extra_notes: list[str] | None = None,
) -> WatchProduct:
    """Assembles and validates the artifact for one watch."""
    sku = make_sku(row.brand, row.model_number)
    attributes = to_attributes(facts.facts, facts.functions)
    # The stock list is authoritative. Research only ever fills a gap the shop
    # left blank — it never overrides something the shop typed.
    model_name = row.model_name or facts.model_name

    section_of = {field: name for name, fields in FACT_GROUPS for field in fields}
    # Ordered by section, so the spec sheet reads the way a brand's own page does.
    order = {field: index for index, (_, fields) in enumerate(FACT_GROUPS) for field in fields}

    # One row per specification. Four sources describing the same watch all state
    # the calibre, and a spec sheet that lists "Calibre 4R35" three times reads as
    # broken. The most authoritative source wins; ties go to the fuller wording,
    # since "23 jewels" tells the reader more than "23".
    trust = {"official": 0, "retailer": 1, "marketplace": 2, "editorial": 3, "other": 4}

    def rank(fact) -> tuple[int, int]:
        source = sources[fact.source_index] if 0 <= fact.source_index < len(sources) else None
        return (trust.get(source.kind if source else "other", 5), -len(fact.value))

    best: dict[str, object] = {}
    for fact in facts.facts:
        if fact.field not in best or rank(fact) < rank(best[fact.field]):  # type: ignore[arg-type]
            best[fact.field] = fact

    specs = [
        Spec(
            label=FACT_LABELS[fact.field],
            value=fact.value,
            group=section_of.get(fact.field, "Specification"),
            source_index=fact.source_index,
        )
        for fact in sorted(best.values(), key=lambda f: (order.get(f.field, 99), f.field))  # type: ignore[union-attr]
    ]

    flags: list[str] = list(extra_flags or [])
    notes: list[str] = list(extra_notes or [])

    def flag(name: str) -> None:
        if name not in flags:
            flags.append(name)

    if not sources:
        flag("no-sources")
    if sources and not facts.matches_reference:
        flag("model-mismatch")
        if facts.mismatch_reason:
            notes.append(facts.mismatch_reason)
    if sources and not any(source.kind == "official" for source in sources):
        flag("no-official-source")

    if not images:
        flag("no-images")
    elif len(images) < 2:
        flag("few-images")

    discovered = [image for image in images if image.source_page is not None]
    if images and not discovered:
        flag("manual-images-only")

    average_match = sum(image.match_score for image in discovered) / len(discovered) if discovered else 0.0
    if discovered and average_match < 0.6:
        flag("low-image-match")

    core_found = sum(1 for field in CORE_FIELDS if any(fact.field == field for fact in facts.facts))
    if core_found < 4:
        flag("sparse-specs")
    if not facts.facts:
        flag("unverified-copy")

    # The shop's price always stands. A very different price on the page is read as
    # evidence about the page — often that it describes a different reference —
    # rather than as a doubt about the stock list.
    listed = [page.listed_price for page in pages if page.listed_price]
    if listed:
        closest = min(listed, key=lambda price: abs(price - row.price))
        if abs(row.price - closest) / closest > 0.6:
            flag("price-outlier")
            publisher = sources[0].publisher if sources else "a source"
            notes.append(
                f"{publisher} quotes {format_inr(closest)} for what it calls this reference, against the shop's "
                f"{format_inr(row.price)}. The shop price is used; the gap may mean that page is a different watch, "
                "so the photographs are worth a glance."
            )

    identity = facts.match_confidence if sources else 0.0
    spec_score = min(1.0, core_found / len(CORE_FIELDS))
    image_score = min(1.0, (len(images) / 3) * 0.5 + average_match * 0.5) if images else 0.0
    overall = round(identity * 0.45 + spec_score * 0.3 + image_score * 0.25, 3)

    status = "needs_review" if (any(f in flags for f in BLOCKING_FLAGS) or overall < 0.55) else "ready"

    mrp = row.mrp if (row.mrp and row.mrp > row.price) else None

    return WatchProduct(
        sku=sku,
        slug=sku,
        status=status,
        brand=row.brand,
        model_number=row.model_number,
        model_name=model_name,
        title=f"{row.brand} {model_name}" if model_name else f"{row.brand} {row.model_number}",
        # Commercial data comes from the stock list only. Nothing researched on the
        # web can change what the shop charges or what it has on the shelf.
        price=Price(
            currency="INR",
            selling=row.price,
            mrp=mrp,
            discount_pct=round((mrp - row.price) / mrp * 100) if mrp else None,
        ),
        collection=infer_collection(facts.collection, row.collection_hint, attributes),
        gender=normalise_gender(row.gender) or normalise_gender(facts.gender),
        tags=facts.tags,
        in_stock=True if row.quantity is None else row.quantity > 0,
        quantity=row.quantity,
        attributes=attributes,
        specs=specs,
        listing_copy=copy,
        images=images,
        backdrop_id=backdrop_id,
        facets=Facets(**derive_facets(attributes, model_name)),
        sources=sources,
        confidence=Confidence(
            overall=overall,
            identity=round(identity, 3),
            specs=round(spec_score, 3),
            images=round(image_score, 3),
        ),
        review=Review(flags=flags, notes=notes),  # type: ignore[arg-type]
        meta=Meta(
            run_id=run_id,
            sheet_row=row.row_number,
            source_file=source_file,
            model=model,
            created_at=now_iso(),
            updated_at=now_iso(),
            cost_usd=round(cost_usd, 6),
            queries=queries,
        ),
    )


def artifact_path(config: AgentConfig, sku: str) -> Path:
    return Path(config.data_dir) / f"{sku}.json"


def write_artifact(product: WatchProduct, config: AgentConfig) -> None:
    """Writes the artifact, preserving the original createdAt when overwriting."""
    path = artifact_path(config, product.sku)
    existing = read_json(path)
    if isinstance(existing, dict):
        created = (existing.get("meta") or {}).get("createdAt")
        if created:
            product.meta.created_at = created
    write_json(path, product.dump())


def rebuild_index(config: AgentConfig) -> list[dict]:
    """Rebuilds the compact index the collections page reads."""
    data_dir = Path(config.data_dir)
    if not data_dir.exists():
        return []

    entries: list[CatalogEntry] = []
    for path in sorted(data_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        raw = read_json(path)
        if not isinstance(raw, dict):
            continue
        try:
            product = WatchProduct.model_validate(raw)
        except Exception:  # noqa: BLE001 - a corrupt artifact must not break the shop
            continue

        entries.append(
            CatalogEntry(
                sku=product.sku,
                slug=product.slug,
                status=product.status,
                brand=product.brand,
                model_number=product.model_number,
                model_name=product.model_name,
                title=product.title,
                price=product.price,
                collection=product.collection,
                gender=product.gender,
                in_stock=product.in_stock,
                backdrop_id=product.backdrop_id,
                facets=Facets(**derive_facets(product.attributes, product.model_name)),
                tags=product.tags,
                image=product.images[0] if product.images else None,
                tagline=product.listing_copy.tagline,
            )
        )

    entries.sort(key=lambda entry: (entry.brand.lower(), entry.title.lower()))
    payload = [entry.dump() for entry in entries]
    write_json(data_dir / "index.json", payload)
    return payload
