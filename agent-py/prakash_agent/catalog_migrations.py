"""Small, idempotent repairs for catalogue identities created by old imports."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from .artifact import rebuild_index
from .config import AgentConfig
from .models import WatchProduct
from .util import make_sku, normalise_model_name, now_iso, read_json, squish, write_json

_PLACEHOLDER = re.compile(r"^(?:sheet\d*|stock|inventory|catalog(?:ue)?|data)$", re.IGNORECASE)
_LEADING_CODE = re.compile(r"^[A-Z0-9._/-]*\d[A-Z0-9._/-]*\s+", re.IGNORECASE)


def _placeholder(value: str) -> bool:
    return bool(_PLACEHOLDER.fullmatch(re.sub(r"[^a-z0-9]", "", value.lower())))


def _split(model_number: str, brands: list[str]) -> tuple[str, str] | None:
    folded = squish(model_number).casefold()
    for brand in sorted(brands, key=len, reverse=True):
        prefix = f"{brand.casefold()} "
        if folded.startswith(prefix):
            reference = squish(model_number[len(brand):])
            if reference:
                return brand, reference
    return None


def _clean_model_name(value: str | None, placeholder: str, brand: str, reference: str) -> str | None:
    text = squish(value)
    for prefix in (placeholder, brand):
        if text.casefold().startswith(f"{prefix.casefold()} "):
            text = squish(text[len(prefix):])
    # Old Sheet1 titles sometimes carried a second, mistyped reference before
    # the real description. A code token is identity noise, not a model name.
    text = _LEADING_CODE.sub("", text)
    return normalise_model_name(text, brand, reference)


def repair_placeholder_brands(config: AgentConfig) -> dict[str, int | list[str]]:
    """Rename legacy ``Sheet1`` products to their embedded real brand/reference."""
    data_dir = Path(config.data_dir)
    media_dir = Path(config.image_dir)
    records: list[tuple[Path, WatchProduct]] = []
    brands: dict[str, str] = {}

    for path in sorted(data_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        raw = read_json(path)
        if not isinstance(raw, dict):
            continue
        try:
            product = WatchProduct.model_validate(raw)
        except Exception:  # noqa: BLE001 - leave a corrupt record for manual repair
            continue
        records.append((path, product))
        if product.brand and not _placeholder(product.brand):
            brands.setdefault(product.brand.casefold(), product.brand)

    repaired = 0
    conflicts: list[str] = []
    for old_path, product in records:
        if not _placeholder(product.brand):
            continue
        identity = _split(product.model_number, list(brands.values()))
        if not identity:
            continue
        brand, reference = identity
        new_sku = make_sku(brand, reference)
        new_path = data_dir / f"{new_sku}.json"
        if new_path != old_path and new_path.exists():
            conflicts.append(product.sku)
            continue

        old_sku = product.sku
        old_brand = product.brand
        product.sku = new_sku
        product.slug = new_sku
        product.brand = brand
        product.model_number = reference
        if not product.reference or product.reference.casefold().startswith(f"{brand.casefold()} "):
            product.reference = reference
        product.model_name = _clean_model_name(product.model_name or product.title, old_brand, brand, reference)
        product.model_name_source_index = None
        product.title = f"{brand} {product.model_name}" if product.model_name else f"{brand} {reference}"
        product.meta.updated_at = now_iso()

        old_prefix = f"/media/{old_sku}/"
        new_prefix = f"/media/{new_sku}/"
        for image in product.images:
            if image.url.startswith(old_prefix):
                image.url = new_prefix + image.url[len(old_prefix):]
            if image.alt.casefold().startswith(f"{old_brand.casefold()} "):
                image.alt = product.title

        old_media = media_dir / old_sku
        new_media = media_dir / new_sku
        if old_media.exists() and old_media != new_media:
            if not new_media.exists():
                old_media.rename(new_media)
            else:
                new_media.mkdir(parents=True, exist_ok=True)
                for file in old_media.iterdir():
                    if file.is_file() and not (new_media / file.name).exists():
                        shutil.move(str(file), str(new_media / file.name))
                shutil.rmtree(old_media, ignore_errors=True)

        write_json(new_path, product.dump())
        if new_path != old_path:
            old_path.unlink(missing_ok=True)
        repaired += 1

    if repaired:
        rebuild_index(config)
    return {"repaired": repaired, "conflicts": conflicts}
