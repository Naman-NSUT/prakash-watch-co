"""Move every catalogue gallery toward three to five photographs.

Every listed watch was matched, once, against a shop that carries that exact
reference. The page is recorded. So there is nothing to search for and nothing
to decide: go back to that page, take the rest of its gallery, stop at five.

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
import argparse
import base64
import json
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
from .storefront import find_product
from .trust import tier
from .util import now_iso, read_json, write_json

#: Three is the quality target and five is the storage and UI ceiling. A watch
#: remains visible if its trusted source cannot supply all three angles.
MIN_GALLERY = 3
MAX_GALLERY = 5

#: Two pictures of the same watch from the same shop are common — the gallery
#: repeats the hero shot at another size. Closer than this and it is a repeat.
NEAR_DUPLICATE = 6


def _host(url: str) -> str:
    return (url or "").lower().split("//")[-1].split("/")[0].removeprefix("www.")


def _is_trusted(url: str, brand: str) -> bool:
    """Use the same path-aware Indian-market policy as research and review."""
    return tier(url, brand) <= 2


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
    return _SHOPIFY_SIZE.sub("", (url or "").split("?")[0])


def asset_name(url: str) -> str:
    """The file's own name, stripped of its address and its size.

    One photograph has two addresses on Shopify: the shop's own domain and
    cdn.shopify.com both serve /…/products/T0854102201300.jpg. Comparing whole
    URLs treats those as two pictures, and a listing ends up showing its hero
    shot twice — which is what happened to 464 listings. The file name is the
    same in both, so that is what identity is taken from.
    """
    return canonical_image(url).rsplit("/", 1)[-1].lower()


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

    brand = product.get("brand") or ""
    return [url for url in seen if _is_trusted(url, brand)]


def apply_gallery_policy(product: dict) -> bool:
    """Cap a gallery and keep its quality warnings current.

    The function is intentionally shared by the preflight pass and every top-up
    result, including failures. A weak gallery remains visible while recovery
    continues, and an explicit manual publication status is left untouched.
    """
    before = json.dumps(product, sort_keys=True, ensure_ascii=False)
    review = product.setdefault("review", {})
    previous_flags = list(review.get("flags") or [])
    flags = [flag for flag in previous_flags if flag not in ("no-images", "few-images")]

    images = list(product.get("images") or [])[:MAX_GALLERY]
    product["images"] = images
    if not images:
        flags.append("no-images")
    elif len(images) < MIN_GALLERY:
        flags.append("few-images")
    review["flags"] = list(dict.fromkeys(flags))
    review.setdefault("notes", [])

    confidence = product.setdefault("confidence", {})
    average_match = (
        sum(float(image.get("matchScore") or 0.0) for image in images) / len(images)
        if images
        else 0.0
    )
    image_score = min(1.0, (len(images) / MIN_GALLERY) * 0.5 + average_match * 0.5) if images else 0.0
    confidence["images"] = round(image_score, 3)
    confidence["overall"] = round(
        float(confidence.get("identity") or 0.0) * 0.45
        + float(confidence.get("specs") or 0.0) * 0.3
        + image_score * 0.25,
        3,
    )

    meta = product.setdefault("meta", {})
    if json.dumps(product, sort_keys=True, ensure_ascii=False) != before:
        meta["updatedAt"] = now_iso()
        return True
    return False


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
    target = max(MIN_GALLERY, min(MAX_GALLERY, target))
    apply_gallery_policy(product)
    existing = list(product.get("images") or [])
    before = len(existing)
    if before >= target:
        return TopUpResult(sku, before, before, None, "already has enough")

    pages = source_pages_for(product)
    if not pages:
        return TopUpResult(sku, before, before, None, "no trusted page on record")

    reference = product.get("reference") or product.get("modelNumber") or ""
    proven_pages = {
        image.get("sourcePage")
        for image in existing
        if image.get("sourcePage") and float(image.get("matchScore") or 0.0) >= 0.6
    }
    have_urls = {canonical_image(image.get("sourceUrl", "")) for image in existing}
    have_names = {asset_name(image.get("sourceUrl", "")) for image in existing if image.get("sourceUrl")}

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
        if candidate not in proven_pages and not names_the_reference(html, candidate, reference):
            notes.append(f"page does not name {reference}")
            continue
        read.append(candidate)
        for url in gallery_urls(html, candidate):
            full = canonical_image(url)
            name = asset_name(url)
            if full in have_urls or name in have_names or _NOT_A_WATCH.search(full):
                continue
            have_urls.add(full)
            have_names.add(name)
            wanted.append((full, candidate))

    # Still short, and the pages on record have given what they have. The other
    # authorised shops are asked whether they carry this exact reference — a
    # feed lookup, cached for the day, costing nothing but bandwidth. A second
    # dealer stocking the same watch is no less credible than the first.
    if before + len(wanted) < target:
        try:
            hit, _note = await find_product([], reference, http, cache, product.get("brand", ""))
        except Exception:  # noqa: BLE001
            hit = None
        if hit and _is_trusted(hit.url, product.get("brand", "")) and hit.url not in read:
            for url in hit.images:
                full = canonical_image(url)
                name = asset_name(url)
                if full in have_urls or name in have_names or _NOT_A_WATCH.search(full):
                    continue
                have_urls.add(full)
                have_names.add(name)
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

                main, has_alpha, backdrop = prepare_background(
                    oriented,
                    size=config.image_canvas,
                    background=config.image_background,
                    # Both of these take product photography off a shop's own
                    # gallery, which is detail shots; a scene would not be
                    # cut out even if one arrived. See images.CUTOUT_SHOTS.
                    attempt_cutout=config.image_cutout,
                    vision_background=None,
                )
                # Hashed after processing, because that is what the stored
                # pictures are; a repeat at another size, or the same file from
                # a second shop, lands within a hamming hair of one already here.
                fingerprint = average_hash(main)
                if any(hamming(fingerprint, seen) <= NEAR_DUPLICATE for seen in have_hashes):
                    continue
                have_hashes.append(fingerprint)

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
                        "view": "unclear",
                        "viewConfidence": 0.0,
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
        apply_gallery_policy(product)
        return TopUpResult(sku, before, before, page, "nothing usable in the gallery")

    product["images"] = [*existing, *added]
    apply_gallery_policy(product)
    return TopUpResult(sku, before, len(product["images"]), page, f"added {len(added)}")


async def run_top_up(
    config: AgentConfig,
    *,
    brand: str | None = None,
    target: int = MAX_GALLERY,
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
        if entry.get("status") != "failed"
        and (brand is None or (entry.get("brand") or "").upper() == brand.upper())
    ]
    wanted.sort(key=lambda entry: entry.get("modelNumber") or "")
    if limit:
        wanted = wanted[:limit]

    target = max(MIN_GALLERY, min(MAX_GALLERY, target))
    results: list[TopUpResult] = []
    policy_changes = 0

    # First normalise every gallery and its warnings without using the network.
    # The slower recovery pass can then fill missing angles in the background.
    for entry in wanted:
        path = artifact_path(config, entry["sku"])
        product = read_json(path)
        if not product:
            continue
        if apply_gallery_policy(product):
            policy_changes += 1
            if not dry_run:
                validated = WatchProduct.model_validate(product)
                path.write_text(json.dumps(validated.dump(), indent=2, ensure_ascii=False) + "\n", "utf-8")
    if policy_changes and not dry_run:
        rebuild_index(config)
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
            before_product = json.dumps(product, sort_keys=True, ensure_ascii=False)
            result = await top_up_product(product, config, http, cache, target)
            results.append(result)
            if on_each:
                on_each(result)
            changed = json.dumps(product, sort_keys=True, ensure_ascii=False) != before_product
            if changed and not dry_run:
                validated = WatchProduct.model_validate(product)  # refuse to write a broken artifact
                path.write_text(json.dumps(validated.dump(), indent=2, ensure_ascii=False) + "\n", "utf-8")
    finally:
        await http.aclose()

    if not dry_run and (policy_changes or any(r.after != r.before for r in results)):
        rebuild_index(config)

    touched = [r for r in results if r.after > r.before]
    held = sum(1 for entry in (read_json(data_dir / "index.json") or []) if entry.get("status") != "ready" and entry.get("imageCount", 0) < MIN_GALLERY)
    return {
        "looked_at": len(results),
        "topped_up": len(touched),
        "photographs_added": sum(r.after - r.before for r in touched),
        "policy_changes": policy_changes,
        "held_below_minimum": held,
        "already_enough": sum(1 for r in results if r.note == "already has enough"),
        "no_page": sum(1 for r in results if r.note == "no trusted page on record"),
        "wrong_page": sum(1 for r in results if r.note.startswith("page does not name")),
        "nothing_new": sum(1 for r in results if r.note in ("gallery holds nothing new", "nothing usable in the gallery")),
        "results": results,
    }


def main(argv: list[str] | None = None) -> int:
    """One-time or manual catalogue pass, with a small resumable status file."""
    from .config import load_config

    parser = argparse.ArgumentParser(description="Keep catalogue galleries between three and five images.")
    parser.add_argument("--target", type=int, default=MAX_GALLERY)
    parser.add_argument("--brand")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    config = load_config(max_images=MAX_GALLERY)
    status_path = Path(config.report_dir) / "gallery-topup-status.json"
    processed = 0

    def publish(state: str, *, report: dict[str, Any] | None = None, error: str | None = None) -> None:
        payload: dict[str, Any] = {
            "state": state,
            "updatedAt": now_iso(),
            "processed": processed,
            "minimum": MIN_GALLERY,
            "maximum": MAX_GALLERY,
            "error": error,
        }
        if report:
            payload.update({key: value for key, value in report.items() if key != "results"})
        write_json(status_path, payload)

    def on_each(_result: TopUpResult) -> None:
        nonlocal processed
        processed += 1
        if processed == 1 or processed % 10 == 0:
            publish("running")

    publish("running")
    try:
        report = asyncio.run(
            run_top_up(
                config,
                brand=args.brand,
                target=args.target,
                limit=args.limit,
                dry_run=args.dry_run,
                on_each=on_each,
            )
        )
    except Exception as error:  # noqa: BLE001
        publish("failed", error=str(error))
        raise
    publish("complete", report=report)
    print(json.dumps({key: value for key, value in report.items() if key != "results"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
