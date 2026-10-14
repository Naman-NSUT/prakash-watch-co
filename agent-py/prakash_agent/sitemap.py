"""Finding a watch on a brand's own site when the brand publishes no feed.

A feed can be asked a direct question, which is why it is preferred, but most
brands publish none. Several of those still publish a sitemap listing every
product page, and some name the reference in the URL itself:

    https://www.tissotwatches.com/en-in/T1562101104100.html

That is as good as a feed for this purpose. The sitemap is read once and kept,
the reference is looked up in it, and the page is fetched only when there is a
page to fetch — so a brand of 580 products costs one file rather than 580
requests, and nothing is crawled speculatively.

The product pages found this way are the brand's own, in this market: the Tissot
page above is titled "Tissot® India" and quotes INR. Photographs are taken only
when the picture's own filename carries the reference, which is how the brand
names them — T156-210-11-041-00_PROFIL.png — so a banner or a "you may also
like" shot cannot arrive with them.
"""

from __future__ import annotations

import re
from typing import Any

from .cache import Cache
from .http_client import HttpClient

#: How long a brand's sitemap is kept. It changes when the brand adds a watch.
SITEMAP_TTL_S = 7 * 24 * 60 * 60

#: A sitemap of a few thousand products runs to a hundred kilobytes or so.
MAX_SITEMAP_BYTES = 8 * 1024 * 1024

#: Where a brand's product sitemap lives, for brands whose robots.txt does not
#: say. Each entry was found by hand and checked: the file exists, it lists this
#: market's pages, and the pages answer an automated reader.
PRODUCT_SITEMAPS: dict[str, tuple[str, ...]] = {
    "tissot": ("https://www.tissotwatches.com/en-au/sitemap-custom-sitemap_0-product-en_IN.xml",),
}

#: Only this market's pages, where a sitemap carries several.
MARKET_HINTS: dict[str, tuple[str, ...]] = {
    "tissot": ("/en-in/",),
}

_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
_IMAGE = re.compile(r"https://[^\"'> ]+?\.(?:jpg|jpeg|png|webp)", re.I)


def normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def _reference_of(url: str) -> str:
    """The reference a product URL names, if its last segment is one."""
    match = re.search(r"/([A-Za-z0-9._-]+)\.html?$", url)
    return normalise(match.group(1)) if match else ""


async def reference_map(brand: str, http: HttpClient, cache: Cache) -> dict[str, str]:
    """Every reference this brand's sitemap names, pointing at its page."""
    key = (brand or "").strip().lower()
    sitemaps = PRODUCT_SITEMAPS.get(key)
    if not sitemaps:
        return {}

    cached = cache.get_json("sitemap", key, SITEMAP_TTL_S)
    if isinstance(cached, dict) and cached.get("map") is not None:
        return cached["map"]

    hints = MARKET_HINTS.get(key, ())
    found: dict[str, str] = {}
    for url in sitemaps:
        # Fetched as bytes, not as a page: a sitemap is served as XML and the
        # page reader refuses anything that is not HTML, rightly.
        got = await http.get_binary(url, MAX_SITEMAP_BYTES)
        body = ""
        if got:
            payload, _content_type = got
            try:
                body = payload.decode("utf-8", "ignore")
            except Exception:  # noqa: BLE001
                body = ""
        for loc in _LOC.findall(body):
            if hints and not any(hint in loc for hint in hints):
                continue
            reference = _reference_of(loc)
            if reference and reference not in found:
                found[reference] = loc

    cache.set_json("sitemap", key, {"map": found})
    return found


async def find_on_brand_site(
    brand: str,
    reference: str,
    http: HttpClient,
    cache: Cache,
) -> tuple[str, list[str]] | None:
    """The brand's own page for this reference, and the photographs on it.

    Returns (url, image urls) or None. Photographs are only those whose own file
    name carries the reference, because that is how a brand names its product
    pictures and it is the one test a banner cannot pass.
    """
    wanted = normalise(reference)
    if len(wanted) < 6:
        return None

    pages = await reference_map(brand, http, cache)
    page = pages.get(wanted)
    if not page:
        return None

    fetched = await http.get_html(page)
    body = (fetched or {}).get("html") or ""
    if not body:
        return None

    images: list[str] = []
    for candidate in _IMAGE.findall(body):
        name = candidate.rsplit("/", 1)[-1]
        if wanted in normalise(name) and candidate not in images:
            images.append(candidate)
    return page, images
