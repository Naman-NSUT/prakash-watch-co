"""Taking a listing back to the brand it belongs to.

Most of the catalogue was identified at a dealer, because a dealer publishes a
feed that can be asked a direct question and most brands do not. That is a sound
second-best and it is how 1,536 listings were built. But where the brand's own
shop will answer, the brand should be the one answering: it is authoritative
about its own reference, its photography is the official photography, and a
listing that cites it is a listing nobody has to take on trust.

So this walks what is published, asks each brand's own shop whether it carries
the reference, and where it does, records the brand as a source and takes its
photographs. No model is asked anything — the watch was identified when the
listing was made, and the shop's feed either carries that exact reference or it
does not. Prices are not touched here or anywhere else in this file.
"""

from __future__ import annotations

import base64
import json
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

from PIL import Image

from .artifact import artifact_path, rebuild_index
from .cache import Cache
from .config import AgentConfig
from .http_client import HttpClient
from .images import MAX_ASSET_BYTES, average_hash, hamming, open_bounded, prepare_background
from .models import WatchProduct
from .storefront import find_product
from .topup import NEAR_DUPLICATE, asset_name, canonical_image, _NOT_A_WATCH
from .trust import official_domains, tier
from .util import now_iso, read_json


async def _official_photographs(
    product: dict,
    hit_images: list[str],
    page: str,
    config: AgentConfig,
    http: HttpClient,
    target: int,
) -> list[dict]:
    """Downloads the brand's own gallery, skipping anything already held."""
    sku = product["sku"]
    existing = list(product.get("images") or [])
    out_dir = Path(config.image_dir) / sku

    have_urls = {canonical_image(i.get("sourceUrl", "")) for i in existing}
    have_names = {asset_name(i.get("sourceUrl", "")) for i in existing if i.get("sourceUrl")}
    have_hashes: list[int] = []
    for image in existing:
        file = out_dir / (image.get("url") or "").rsplit("/", 1)[-1]
        if file.exists():
            try:
                with open_bounded(file.read_bytes(), 256) as opened:
                    have_hashes.append(average_hash(opened))
            except Exception:  # noqa: BLE001
                pass

    added: list[dict] = []
    position = len(existing)
    for url in hit_images:
        if len(existing) + len(added) >= target:
            break
        full = canonical_image(url)
        if full in have_urls or asset_name(url) in have_names or _NOT_A_WATCH.search(full):
            continue
        got = await http.get_binary(url, MAX_ASSET_BYTES)
        if not got:
            continue
        payload, content_type = got
        if (content_type and not content_type.lower().startswith("image/")) or len(payload) < 4096:
            continue
        try:
            with open_bounded(payload) as oriented:
                if min(oriented.size) < config.min_image_width // 2:
                    continue
                main, has_alpha, backdrop = prepare_background(
                    oriented,
                    size=config.image_canvas,
                    background=config.image_background,
                    attempt_cutout=config.image_cutout,
                    vision_background=None,
                )
                fingerprint = average_hash(main)
                if any(hamming(fingerprint, seen) <= NEAR_DUPLICATE for seen in have_hashes):
                    continue
                have_hashes.append(fingerprint)
                have_urls.add(full)
                have_names.add(asset_name(url))

                encoded = BytesIO()
                main.save(encoded, format="WEBP", quality=82)
                blob = encoded.getvalue()
                position += 1
                name = f"{position:02d}-{sha256(blob).hexdigest()[:8]}.webp"
                out_dir.mkdir(parents=True, exist_ok=True)
                (out_dir / name).write_bytes(blob)

                blur = main.convert("RGB")
                blur.thumbnail((16, 16), Image.Resampling.LANCZOS)
                buf = BytesIO()
                blur.save(buf, format="WEBP", quality=40)

                added.append({
                    "url": f"{config.image_url_base}/{sku}/{name}",
                    "width": main.width,
                    "height": main.height,
                    "alt": f"{product.get('brand', '')} {product.get('modelNumber', '')}".strip(),
                    "kind": "product",
                    "blurDataURL": "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
                    "sourceUrl": url,
                    "sourcePage": page,
                    "matchScore": 0.95,
                    "hasAlpha": bool(has_alpha),
                    "background": backdrop,
                })
        except Exception:  # noqa: BLE001
            continue
    return added


async def promote_product(
    product: dict,
    config: AgentConfig,
    http: HttpClient,
    cache: Cache,
    target: int = 4,
) -> dict[str, Any]:
    brand = product.get("brand") or ""
    reference = product.get("modelNumber") or ""
    hosts = [d for d in official_domains(brand)]
    if not hosts or not reference:
        return {"state": "no official site"}

    sources = product.get("sources") or []
    if any(tier(s.get("url", ""), brand) == 1 for s in sources):
        return {"state": "already cites the brand"}

    try:
        hit, _note = await find_product(hosts, reference, http, cache, brand)
    except Exception:  # noqa: BLE001
        return {"state": "shop would not answer"}
    if not hit:
        return {"state": "brand's shop does not carry it"}

    photos = await _official_photographs(product, list(hit.images), hit.url, config, http, target)

    product["sources"] = [
        *sources,
        {
            "index": len(sources),
            "url": hit.url,
            "title": hit.title or f"{brand} {reference}",
            "publisher": hit.url.split("//")[-1].split("/")[0].removeprefix("www."),
            "kind": "official",
            "fetchedAt": now_iso(),
        },
    ]
    if photos:
        product["images"] = [*(product.get("images") or []), *photos]
    return {"state": "promoted", "url": hit.url, "photographs": len(photos)}


async def run_promotion(
    config: AgentConfig,
    *,
    brand: str | None = None,
    limit: int | None = None,
    target: int = 4,
    dry_run: bool = False,
    on_each: Callable[[str, dict], None] | None = None,
) -> dict[str, Any]:
    data_dir = Path(config.data_dir)
    index = read_json(data_dir / "index.json") or []
    wanted = [
        e for e in index
        if e.get("status") == "ready"
        and (brand is None or (e.get("brand") or "").upper() == brand.upper())
    ]
    if limit:
        wanted = wanted[:limit]

    cache = Cache(Path(config.cache_dir))
    http = HttpClient(config, cache)
    tally: dict[str, int] = {}
    photographs = 0
    try:
        for entry in wanted:
            path = artifact_path(config, entry["sku"])
            product = read_json(path)
            if not product:
                continue
            result = await promote_product(product, config, http, cache, target)
            tally[result["state"]] = tally.get(result["state"], 0) + 1
            photographs += result.get("photographs", 0)
            if on_each:
                on_each(entry["sku"], result)
            if result["state"] == "promoted" and not dry_run:
                WatchProduct.model_validate(product)
                path.write_text(json.dumps(product, indent=2, ensure_ascii=False) + "\n", "utf-8")
    finally:
        await http.aclose()

    if not dry_run and tally.get("promoted"):
        rebuild_index(config)
    return {"looked_at": len(wanted), "photographs_added": photographs, **tally}
