"""Research stage: find pages describing the exact reference, read them, and turn
them into evidence the extraction stage can cite.

Search engines return near misses constantly — asking for T127.407.11.041.00
surfaces …051.00, and EFR-539DE-8AV surfaces EFR-539DE-8A — so candidates are
scored on reference match and domain trust before anything is fetched.
"""

from __future__ import annotations

import json
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .brands import blocks_bots, is_brand_site, is_indian_url
from .config import AgentConfig
from .http_client import HttpClient
from .models import Candidate, ScrapedPage, SheetRow, Source
from .openrouter import OpenRouterClient
from .util import now_iso, squish, truncate, uniq_by

# Marketplaces: rich spec tables, but listings are often third-party or wrong.
MARKETPLACE_HOSTS = ("amazon.", "flipkart.", "ebay.", "aliexpress.", "myntra.", "ajio.", "snapdeal.", "indiamart.", "etsy.")

# Retailers and databases that publish reliable specification tables.
RETAILER_HOSTS = (
    "chrono24.", "watchbase.", "creationwatches.", "jomashop.", "ethoswatches.", "kamalwatch.",
    "helioswatchstore.", "watchstation.", "tatacliq.", "watches2u.", "watchshop.", "hodinkee.",
    "swisstimehouse.", "titanworld.", "kewalrams.",
)

EDITORIAL_HINTS = ("review", "blog", "news", "magazine", "hands-on", "monochrome", "wornandwound", "oracleoftime")

KIND_WEIGHT = {"official": 100, "retailer": 60, "marketplace": 40, "editorial": 25, "other": 20}

#: A candidate scoring this high has the reference in its URL or title.
CONFIDENT_SCORE = 130

_IMAGE_NOISE = re.compile(r"(logo|sprite|icon|favicon|placeholder|banner|payment|badge|flag|avatar|thumb_|swatch)", re.I)
_LISTING_PATH = re.compile(r"/(search|category|collections?)/?($|\?)", re.I)


def reference_variants(model_number: str) -> list[str]:
    """Normalised forms of a reference.

    Brands strip separators when building URLs (T127.407.11.041.00 →
    T1274071104100), which makes this the strongest signal a page is the right one.
    Indian-market stock also carries regional suffixes the brand's global pages
    omit: EFR-539DE-8AV is sold worldwide as EFR-539DE-8A, and Seiko's K1/J1 denote
    the market rather than the watch.
    """
    lower = model_number.lower().strip()
    compact = re.sub(r"[^a-z0-9]", "", lower)
    no_suffix = re.sub(r"(udf|dr|df|k1|k2|j1|p1|v)$", "", compact)
    return [v for v in dict.fromkeys([lower, compact, no_suffix]) if len(v) >= 4]


def mentions_reference(haystack: str, model_number: str) -> bool:
    lowered = (haystack or "").lower()
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    return any(v in lowered or v in compact for v in reference_variants(model_number))


def host_of(url: str | None) -> str | None:
    if not url:
        return None
    try:
        netloc = urlparse(url).netloc
        return netloc or None
    except ValueError:
        return None


def _same_site(a: str, b: str) -> bool:
    left = a.lower().removeprefix("www.")
    right = b.lower().removeprefix("www.")
    return left == right or left.endswith(f".{right}") or right.endswith(f".{left}")


def classify_domain(url: str, brand: str, official_host: str | None = None) -> str:
    host = (host_of(url) or "").lower()
    if not host:
        return "other"

    # The brand's own Indian site, and the site named in the sheet header, are
    # authoritative by definition.
    if is_brand_site(url, brand):
        return "official"
    if official_host and _same_site(host, official_host):
        return "official"

    brand_token = re.sub(r"[^a-z0-9]", "", brand.lower())
    if len(brand_token) >= 4 and brand_token in re.sub(r"[^a-z0-9]", "", host):
        # The brand's own site, but another market's edition of it — casio.com/intl
        # rather than casio.com/in. It describes the global reference, which is
        # often not the one sold here, so it does not get to speak as the brand.
        return "official" if is_indian_url(url, brand) else "editorial"
    if any(h in host for h in MARKETPLACE_HOSTS):
        return "marketplace"
    if any(h in host for h in RETAILER_HOSTS):
        return "retailer"
    if any(h in host or h in url.lower() for h in EDITORIAL_HINTS):
        return "editorial"
    return "other"


def rank_candidates(hits: list[dict[str, str]], row: SheetRow, india_only: bool = True) -> list[Candidate]:
    """Ranks search hits so the agent spends its few page fetches well.

    Queries are deliberately left bare — adding "India" was measured to make
    results *worse*, returning news and category pages instead of the product — so
    the market filter is applied here instead, where it is exact.
    """
    official_host = host_of(row.brand_site)
    scored: list[Candidate] = []

    for hit in hits:
        url = hit.get("url", "")
        if not url.lower().startswith(("http://", "https://")):
            continue

        indian = is_indian_url(url, row.brand)
        # Strict mode reads Indian sources and nothing else. It is off by default:
        # measured on this catalogue it left six watches with two sources between
        # them, because the search backends surface very few Indian product pages.
        if india_only and not indian:
            continue

        title = squish(hit.get("title", ""))
        snippet = squish(hit.get("content", ""))
        kind = classify_domain(url, row.brand, official_host)
        score = float(KIND_WEIGHT[kind])
        # India first regardless of mode: an Indian page outranks a foreign one of
        # the same type, so the sources actually read describe the Indian article.
        score += 55 if indian else -25

        # Reference in the URL is near-proof; in the title or snippet, strong support.
        if mentions_reference(url, row.model_number):
            score += 90
        if mentions_reference(title, row.model_number):
            score += 45
        if mentions_reference(snippet, row.model_number):
            score += 25

        haystack = f"{title} {snippet}".lower()
        if row.brand.lower() in haystack:
            score += 15
        if row.model_name and row.model_name.lower() in haystack:
            score += 12
        # Listing and category pages rarely describe one reference.
        if _LISTING_PATH.search(url):
            score -= 35

        scored.append(Candidate(url=url, title=title, snippet=snippet, kind=kind, score=score))

    deduped = uniq_by(scored, lambda c: re.sub(r"[#?].*$", "", c.url))
    return sorted(deduped, key=lambda c: c.score, reverse=True)


def build_queries(row: SheetRow) -> list[str]:
    """Search queries, most precise first.

    Kept deliberately bare. The reference is a rare token and engines rank on it
    strongly; padding the query with "specifications official product page", or
    pinning it to the brand's domain with site:, measurably *lowered* quality —
    a bare "TITAN 95047WM01 watch" returned the official product page plus the
    retailer listings, while the padded variants returned generic category pages.
    """
    name = f" {row.model_name}" if row.model_name else ""
    return [
        f"{row.brand} {row.model_number} watch",
        f"{row.brand} {row.model_number}{name} watch price specifications",
    ]


def _looks_like_product_image(url: str) -> bool:
    if not url.lower().startswith(("http://", "https://")):
        return False
    if re.search(r"\.svg(\?|$)", url, re.I):
        return False
    return not _IMAGE_NOISE.search(url)


def _best_from_srcset(srcset: str, base: str) -> str | None:
    best_url, best_width = None, -1
    for part in srcset.split(","):
        bits = part.strip().split()
        if not bits:
            continue
        candidate = urljoin(base, bits[0])
        width = 0
        if len(bits) > 1 and bits[1].endswith("w"):
            try:
                width = int(bits[1][:-1])
            except ValueError:
                width = 0
        if width >= best_width:
            best_url, best_width = candidate, width
    return best_url


def _find_product_jsonld(soup: BeautifulSoup) -> dict | None:
    blocks: list = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text() or ""
        if not raw.strip():
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue  # Malformed JSON-LD is common; ignore rather than fail the page.
        blocks.extend(parsed if isinstance(parsed, list) else [parsed])

    flat: list = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        flat.append(block)
        graph = block.get("@graph")
        if isinstance(graph, list):
            flat.extend(g for g in graph if isinstance(g, dict))

    for node in flat:
        node_type = node.get("@type")
        if node_type == "Product" or (isinstance(node_type, list) and "Product" in node_type):
            return node
    return None


def scrape_page(html: str, url: str) -> ScrapedPage:
    """Parses one product page into the pieces the extractor needs."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()

    def meta(selector: str, attr: str, value: str) -> str:
        tag = soup.find(selector, attrs={attr: value})
        return squish(tag.get("content", "")) if tag else ""

    json_ld = _find_product_jsonld(soup)
    title = squish(soup.title.get_text() if soup.title else "") or meta("meta", "property", "og:title")
    description = meta("meta", "property", "og:description") or meta("meta", "name", "description")

    # Specification tables and definition lists — the highest-signal content.
    spec_pairs: list[tuple[str, str]] = []
    for table_row in soup.find_all("tr"):
        cells = table_row.find_all(["th", "td"])
        if len(cells) != 2:
            continue
        label, value = squish(cells[0].get_text()), squish(cells[1].get_text())
        if label and value and len(label) < 60 and len(value) < 160:
            spec_pairs.append((label, value))

    for definition_list in soup.find_all("dl"):
        terms = definition_list.find_all("dt")
        definitions = definition_list.find_all("dd")
        for term, definition in zip(terms, definitions):
            label, value = squish(term.get_text()), squish(definition.get_text())
            if label and value and len(label) < 60 and len(value) < 160:
                spec_pairs.append((label, value))

    # Images, best sources first.
    image_urls: list[str] = []

    def push(candidate: str | None) -> None:
        if not candidate:
            return
        resolved = urljoin(url, candidate)
        if _looks_like_product_image(resolved):
            image_urls.append(resolved)

    if json_ld:
        ld_image = json_ld.get("image")
        if isinstance(ld_image, str):
            push(ld_image)
        elif isinstance(ld_image, list):
            for entry in ld_image:
                push(entry if isinstance(entry, str) else (entry or {}).get("url"))
        elif isinstance(ld_image, dict):
            push(ld_image.get("url"))

    push(meta("meta", "property", "og:image") or None)
    push(meta("meta", "name", "twitter:image") or None)

    for img in soup.find_all("img"):
        try:
            width = int(str(img.get("width", "0")).strip() or 0)
        except ValueError:
            width = 0
        if width and width < 200:
            continue
        srcset = img.get("srcset") or img.get("data-srcset")
        if srcset:
            best = _best_from_srcset(srcset, url)
            if best and _looks_like_product_image(best):
                image_urls.append(best)
        push(img.get("src") or img.get("data-src") or img.get("data-zoom-image") or img.get("data-large_image"))

    # Structured price, used to sanity-check the sheet.
    listed_price: float | None = None
    if json_ld:
        offers = json_ld.get("offers")
        offer = offers[0] if isinstance(offers, list) and offers else offers
        if isinstance(offer, dict):
            raw_price = offer.get("price") or offer.get("lowPrice")
            currency = str(offer.get("priceCurrency", "")).upper()
            if raw_price is not None and currency in ("INR", ""):
                try:
                    value = float(re.sub(r"[^0-9.]", "", str(raw_price)))
                    listed_price = value if value > 0 else None
                except ValueError:
                    listed_price = None

    main = soup.find("main")
    body_text = squish((main or soup.body or soup).get_text(" "))

    return ScrapedPage(
        url=url,
        title=title,
        description=description,
        spec_pairs=uniq_by(spec_pairs, lambda p: f"{p[0]}:{p[1]}".lower())[:40],
        text=truncate(body_text, 3500),
        image_urls=uniq_by(image_urls, lambda u: re.sub(r"[#?].*$", "", u))[:25],
        listed_price=listed_price,
    )


async def gather_evidence(
    row: SheetRow,
    config: AgentConfig,
    http: HttpClient,
    llm: OpenRouterClient,
    on_stage,
) -> dict:
    """Searches, ranks, fetches and parses. A product URL in the sheet skips search."""
    cost = 0.0
    queries: list[str] = []
    hits: list[dict[str, str]] = []

    if row.product_url:
        hits.append({"url": row.product_url, "title": f"{row.brand} {row.model_number}", "content": ""})
        on_stage("research", "using the product URL from the sheet")

    def settled() -> bool:
        return any(c.score >= CONFIDENT_SCORE for c in rank_candidates(hits, row))

    for query in build_queries(row):
        if settled():
            break
        queries.append(query)
        result = await llm.search(query, 6)
        cost += result["costUsd"]
        hits.extend(result["citations"])
        on_stage("search", f"{len(result['citations'])} result(s)" + (" (cached)" if result["cached"] else ""))

    # Last resort: the reference alone. Dropping the brand helps when every page
    # title is padded with it, and the reference is still a rare token.
    if not settled():
        query = f"{row.model_number} watch"
        queries.append(query)
        result = await llm.search(query, 8)
        cost += result["costUsd"]
        hits.extend(result["citations"])
        on_stage("search", f"retried on the bare reference — {len(result['citations'])} result(s)")

    pages: list[ScrapedPage] = []
    sources: list[Source] = []

    for candidate in rank_candidates(hits, row):
        if len(pages) >= config.max_sources:
            break
        fetched = await http.get_html(candidate.url)
        if not fetched:
            continue

        page = scrape_page(fetched["html"], fetched["finalUrl"])
        # A page with no usable content is not worth an evidence slot.
        if not page.text and not page.spec_pairs:
            continue

        sources.append(
            Source(
                index=len(sources),
                url=page.url,
                title=page.title or candidate.title,
                publisher=(host_of(page.url) or "unknown").removeprefix("www."),
                kind=candidate.kind,
                fetched_at=now_iso(),
            )
        )
        pages.append(page)

    confirmed = sum(
        1
        for page in pages
        if mentions_reference(
            f"{page.url} {page.title} {page.text} {' '.join(v for pair in page.spec_pairs for v in pair)}",
            row.model_number,
        )
    )
    on_stage("read", f"{len(pages)} page(s), {confirmed} confirming the reference")

    return {
        "sources": sources,
        "pages": pages,
        "queries": queries,
        "cost_usd": cost,
        "confirmed_ref_pages": confirmed,
    }


def render_evidence(sources: list[Source], pages: list[ScrapedPage]) -> str:
    """Renders the evidence bundle as the numbered block shown to the model."""
    if not pages:
        return "(no sources could be read)"

    blocks: list[str] = []
    for index, page in enumerate(pages):
        specs = ""
        if page.spec_pairs:
            lines = "\n".join(f"  - {label}: {value}" for label, value in page.spec_pairs)
            specs = f"\nSpecification table:\n{lines}"
        price = f"\nListed price on page: INR {page.listed_price}" if page.listed_price else ""
        description = f"Description: {page.description}\n" if page.description else ""
        blocks.append(
            f"[SOURCE {index}] {sources[index].kind.upper()} — {page.url}\n"
            f"Title: {page.title}\n{description}{specs}{price}\n"
            f"Page text: {page.text}"
        )
    return "\n\n---\n\n".join(blocks)
