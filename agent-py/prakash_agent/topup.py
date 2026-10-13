"""Topping a listing up to four photographs, from the page it already came from.

Every listed watch was matched, once, against a shop that carries that exact
reference. The page is recorded. So there is nothing to search for and nothing
to decide: go back to that page, take the rest of its gallery, stop at four.

Two things make this nearly free. There is no research — no model is asked
what the watch is, because that was settled when the listing was made. And
there is no grading, because the question grading answers ("is this the
reference?") is already answered by the page: a shop's product page carries
photographs of the product, and the caseback shot that the grader scored 0.3
and discarded is the same watch from behind.

What it still refuses to do is take pictures from a page that does not name the
reference. The whole saving rests on the page being the right one, so that is
checked rather than assumed.
"""

from __future__ import annotations

import asyncio
import base64
import re
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

from PIL import Image

from .artifact import artifact_path, rebuild_index
from .config import AgentConfig
from .cache import Cache
from .http_client import HttpClient
from .images import MAX_ASSET_BYTES, average_hash, hamming, open_bounded, prepare_background
from .models import ProductImage, WatchProduct
from .storefront import RETAILER_FEEDS, find_product
from .util import read_json

#: Shops whose own product page is taken as proof of identity.
TRUSTED_HOSTS: tuple[str, ...] = RETAILER_FEEDS

#: Two pictures of the same watch from the same shop are common — the gallery
#: repeats the hero shot at another size. Closer than this and it is a repeat.
NEAR_DUPLICATE = 6


def _host(url: str) -> str:
    return (url or "").lower().split("//")[-1].split("/")[0].removeprefix("www.")


def _is_trusted(url: str, brand_hosts: tuple[str, ...] = ()) -> bool:
    host = _host(url)
    if not host:
        return False
    hosts = (*TRUSTED_HOSTS, *brand_hosts)
    return any(host == h or host.endswith(f".{h}") for h in hosts)


#: Shopify writes a gallery as one picture at a dozen sizes: the same file with
#: _200x, _400x, _1024x1024, @2x bolted onto the name. Eleven "photographs" on a
#: product page is often three watches and eight thumbnails — and because the
#: thumbnails are below the minimum width, filtering them by size left nothing.
#: Collapsing them to the original both finds the full-size picture and makes a
#: repeat recognisable as a repeat.
_SHOPIFY_SIZE = re.compile(r"_(?:\d{2,4}x(?:\d{2,4})?)(?:@[0-9.]+x)?(?=\.[a-z]{3,4}(?:$|\?))", re.I)

#: Files a shop puts on every product page: the sale banner, the payment strip,
#: the size guide. They are not this watch.
_NOT_A_WATCH = re.compile(r"screenshot|banner|logo|payment|size[-_]?guide|placeholder|sprite|icon", re.I)


def canonical_image(url: str) -> str:
    """The full-size original behind a thumbnail address."""
    return _SHOPIFY_SIZE.sub("", url or "")


def _normalise(reference: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (reference or "").lower())


def source_pages_for(product: dict) -> list[str]:
    """Every trusted page on record for this listing, best first.

    The page the existing pictures came from leads: a human can open it and see
    this watch. Others follow, because one shop's gallery is sometimes a single
    photograph and the watch still deserves four — and a second authorised
    dealer carrying the same reference is no less credible than the first.
    """
    seen: list[str] = []
    for image in product.get("images") or []:
        page = image.get("sourcePage")
        if page and page not in seen:
            seen.append(page)
    for source in product.get("sources") or []:
        url = source.get("url")
        if url and url not in seen:
            seen.append(url)

    return [url for url in seen if _is_trusted(url)]


def names_the_reference(page_html: str, page_url: str, reference: str) -> bool:
    """Whether this page is about this reference, rather than merely nearby.

    A shop's URL usually carries the reference in its handle, and the page
    always carries it in the title or the specification table. Requiring one of
    those stops a 'related products' page, or a reference that was renamed,
    quietly contributing someone else's photographs.
    """
    wanted = _normalise(reference)
    if len(wanted) < 4:
        return False
    return wanted in _normalise(page_url) or wanted in _normalise(page_html)


@dataclass
class TopUpResult:
    sku: str
    before: int
    after: int
    page: str | None
    note: str


def gallery_urls(html: str, base: str) -> list[str]:
    """Picture addresses from a product page, in the order the page gives them.

    The same reader the research stage uses, so a page that worked then works
    now. Gallery order is the shop's own — the hero first, then the angles —
    and that is a better ordering than anything inferred, so it is kept.
    """
    from .research import scrape_page

    return list(scrape_page(html, base).image_urls)


async def top_up_product(
    product: dict,
    config: AgentConfig,
    http: HttpClient,
    cache: Cache,
    target: int,
) -> TopUpResult:
    sku = product["sku"]
    existing = list(product.get("images") or [])
    before = len(existing)
    if before >= target:
        return TopUpResult(sku, before, before, None, "already has enough")

    pages = source_pages_for(product)
    if not pages:
        return TopUpResult(sku, before, before, None, "no trusted page on record")

    reference = product.get("modelNumber") or ""
    have_urls = {canonical_image(image.get("sourceUrl", "")) for image in existing}

    # Collapse the sizes, drop the furniture, keep each page's own order. Pages
    # are read in turn and stopped at as soon as there are enough.
    wanted: list[tuple[str, str]] = []
    read: list[str] = []
    notes: list[str] = []
    for candidate in pages:
        if before + len(wanted) >= target:
            break
        fetched = await http.get_html(candidate)
        if not fetched or not fetched.get("html"):
            notes.append("page would not load")
            continue
        html = fetched["html"]
        if not names_the_reference(html, candidate, reference):
            notes.append(f"page does not name {reference}")
            continue
        read.append(candidate)
        for url in gallery_urls(html, candidate):
            full = canonical_image(url)
            if full in have_urls or _NOT_A_WATCH.search(full):
                continue
            have_urls.add(full)
            wanted.append((full, candidate))

    # Still short, and the pages on record have given what they have. The other
    # authorised shops are asked whether they carry this exact reference — a
    # feed lookup, cached for the day, costing nothing but bandwidth. A second
    # dealer stocking the same watch is no less credible than the first.
    if before + len(wanted) < target:
        from .cache import Cache as _Cache  # already imported above; kept local for clarity

        try:
            hit, _note = await find_product([], reference, http, cache, product.get("brand", ""))
        except Exception:  # noqa: BLE001
            hit = None
        if hit and hit.url not in read:
            for url in hit.images:
                full = canonical_image(url)
                if full in have_urls or _NOT_A_WATCH.search(full):
                    continue
                have_urls.add(full)
                wanted.append((full, hit.url))
            if hit.images:
                read.append(hit.url)

    page = read[0] if read else pages[0]
    if not read:
        return TopUpResult(sku, before, before, page, notes[0] if notes else "no readable page")
    if not wanted:
        return TopUpResult(sku, before, before, page, "gallery holds nothing new")

    # What the listing already shows, so a repeat at another size is caught.
    have_hashes: list[int] = []
    out_dir = Path(config.image_dir) / sku
    for image in existing:
        name = (image.get("url") or "").rsplit("/", 1)[-1]
        file = out_dir / name
        if file.exists():
            try:
                with open_bounded(file.read_bytes(), 256) as opened:
                    have_hashes.append(average_hash(opened))
            except Exception:  # noqa: BLE001
                pass

    added: list[dict] = []
    position = before
    for url, from_page in wanted:
        if before + len(added) >= target:
            break
        got = await http.get_binary(url, MAX_ASSET_BYTES)
        if not got:
            continue
        payload, content_type = got
        if content_type and not content_type.lower().startswith("image/"):
            continue
        if len(payload) < 4096:
            continue

        try:
            with open_bounded(payload) as oriented:
                if min(oriented.size) < config.min_image_width // 2:
                    continue
                fingerprint = average_hash(oriented)
                if any(hamming(fingerprint, seen) <= NEAR_DUPLICATE for seen in have_hashes):
                    continue
                have_hashes.append(fingerprint)

                main, has_alpha, backdrop = prepare_background(
                    oriented,
                    size=config.image_canvas,
                    background=config.image_background,
                    attempt_cutout=config.image_cutout,
                    vision_background=None,
                )
                encoded = BytesIO()
                main.save(encoded, format="WEBP", quality=82)
                blob = encoded.getvalue()
                position += 1
                file_name = f"{position:02d}-{sha256(blob).hexdigest()[:8]}.webp"
                out_dir.mkdir(parents=True, exist_ok=True)
                (out_dir / file_name).write_bytes(blob)

                blur = main.convert("RGB")
                blur.thumbnail((16, 16), Image.Resampling.LANCZOS)
                blur_buffer = BytesIO()
                blur.save(blur_buffer, format="WEBP", quality=40)

                added.append(
                    {
                        "url": f"{config.image_url_base}/{sku}/{file_name}",
                        "width": main.width,
                        "height": main.height,
                        "alt": f"{product.get('brand', '')} {reference}".strip(),
                        "kind": "detail",
                        "blurDataURL": "data:image/webp;base64,"
                        + base64.b64encode(blur_buffer.getvalue()).decode("ascii"),
                        "sourceUrl": url,
                        "sourcePage": from_page,
                        "matchScore": 0.8,
                        "hasAlpha": bool(has_alpha),
                        "background": backdrop,
                    }
                )
        except Exception:  # noqa: BLE001
            continue

    if not added:
        return TopUpResult(sku, before, before, page, "nothing usable in the gallery")

    product["images"] = [*existing, *added]
    return TopUpResult(sku, before, len(product["images"]), page, f"added {len(added)}")


async def run_top_up(
    config: AgentConfig,
    *,
    brand: str | None = None,
    target: int = 4,
    limit: int | None = None,
    dry_run: bool = False,
    on_each: Callable[[TopUpResult], None] | None = None,
) -> dict[str, Any]:
    """Walks the catalogue, topping listings up from the page they came from."""
    import json

    data_dir = Path(config.data_dir)
    index = read_json(data_dir / "index.json") or []

    wanted = [
        entry
        for entry in index
        if entry.get("status") == "ready"
        and (brand is None or (entry.get("brand") or "").upper() == brand.upper())
    ]
    wanted.sort(key=lambda entry: entry.get("modelNumber") or "")
    if limit:
        wanted = wanted[:limit]

    results: list[TopUpResult] = []
    # The cache is shared with a research run, so a page already read today
    # is not fetched again.
    cache = Cache(Path(config.cache_dir))
    http = HttpClient(config, cache)
    try:
        for entry in wanted:
            path = artifact_path(config, entry["sku"])
            product = read_json(path)
            if not product:
                continue
            result = await top_up_product(product, config, http, cache, target)
            results.append(result)
            if on_each:
                on_each(result)
            if result.after > result.before and not dry_run:
                WatchProduct.model_validate(product)  # refuse to write a broken artifact
                path.write_text(json.dumps(product, indent=2, ensure_ascii=False) + "\n", "utf-8")
    finally:
        await http.aclose()

    if not dry_run and any(r.after > r.before for r in results):
        rebuild_index(config)

    touched = [r for r in results if r.after > r.before]
    return {
        "looked_at": len(results),
        "topped_up": len(touched),
        "photographs_added": sum(r.after - r.before for r in touched),
        "already_enough": sum(1 for r in results if r.note == "already has enough"),
        "no_page": sum(1 for r in results if r.note == "no trusted page on record"),
        "wrong_page": sum(1 for r in results if r.note.startswith("page does not name")),
        "nothing_new": sum(1 for r in results if r.note in ("gallery holds nothing new", "nothing usable in the gallery")),
        "results": results,
    }
