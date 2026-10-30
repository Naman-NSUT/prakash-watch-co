"""The house's order of trust, in one place.

Three different questions used to be answered by one tuple of hostnames, and
because they were the same tuple, adding a shop for one purpose silently granted
it the other two. They are separated here:

  tier 1  the brand's own site — authoritative about its own watches
  tier 2  the dealers the shop buys from and vouches for by doing so
  index   shops consulted ONLY to translate a shop code into the brand's
          reference, and which never supply a fact, a photograph or a price

A listing may be published when everything it was built from — every source and
every photograph — comes from tier 1 or tier 2. Anything else is held for a
person to look at before the shop's name goes on it.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .brands import BRANDS, _norm, is_indian_url

#: Tier 2. Named by the shop, one at a time, because it buys from them.
TRUSTED_DEALERS: tuple[str, ...] = (
    "rameshwatch.com",
    "kamalwatch.com",
    "justintime.in",
    "watchfactory.in",
    "casiostore.bhawar.com",
    "avikya.in",
)

#: Consulted only to resolve a code. 335 of 336 Casio rows carry the shop's own
#: four-character code rather than a Casio reference, and a retailer that indexes
#: both is the only place that mapping can be read. Reading it there is fine;
#: describing the watch from there is not, so nothing but the reference crosses
#: over, and the listing is then built from the brand or a vouched dealer.
REFERENCE_INDEX: tuple[str, ...] = (
    *TRUSTED_DEALERS,
    "titanworld.com",
    "helioswatchstore.com",
    "swisstimehouse.com",
    "kewalrams.com",
    "zimsonwatches.com",
    "watchbase.com",
)


#: Brand storefronts that are the brand's but not this market's.
#:
#: Measured rather than inferred from the domain, because the domain lies in both
#: directions: boat-lifestyle.com and gonoise.com are Indian brands on .com and
#: price in rupees, while danielwellington.com/in — an India path on the brand's
#: own site — answers in euros. Each of these was read and found quoting USD or
#: EUR, or names another market outright.
#:
#: A foreign storefront sells a different article: another market's variant of
#: the reference, in another currency, under another warranty. It is the brand,
#: so it reads as authoritative, and that is exactly what makes it dangerous —
#: a Tissot reached this shop at ₹625 because a dollar figure arrived looking
#: like a rupee one. The shop sells Indian-market references, so these do not
#: speak for the brand here and are not read at all.
FOREIGN_BRAND_HOSTS: tuple[str, ...] = (
    "guesswatches.com",        # USD
    "gcwatches.com",           # USD
    "kennethcole.com",         # USD, and a US apparel store — 102 of its 1,949 products are watches
    "justcavalliwatches.com",  # EUR
    "danielwellington.com",    # EUR, even on /in
    "usa.tommy.com",           # names its market in its hostname
    "armani.com",              # the global store; armaniexchange.in is the Indian one
    "calvinklein.com",         # the global store
    "seikowatches.com",        # the global store; seikowatches.co.in is the Indian one
    "michaelkors.global",      # the global store; the /in/en locale is kept below
)

#: Locales of an otherwise foreign host that do serve this market.
INDIAN_LOCALES: tuple[str, ...] = ("michaelkors.global/in/en",)


def is_foreign_brand_host(domain: str) -> bool:
    """Whether a brand's own domain belongs to another market."""
    lowered = (domain or "").lower().removeprefix("www.")
    if any(lowered.startswith(keep) for keep in INDIAN_LOCALES):
        return False
    host = lowered.split("/")[0]
    return any(host == f or host.endswith(f".{f}") for f in FOREIGN_BRAND_HOSTS)


def host_of(url: str) -> str:
    """The bare hostname, lowercased, without www."""
    return (url or "").lower().split("//")[-1].split("/")[0].removeprefix("www.").strip()


def _matches(host: str, domain: str) -> bool:
    domain = domain.split("/")[0].lower().removeprefix("www.")
    return bool(host) and bool(domain) and (host == domain or host.endswith(f".{domain}"))


def _matches_url(url: str, domain: str) -> bool:
    """Match a trusted entry including its market path, when it has one.

    Comparing only hostnames made ``tissotwatches.com/en-us`` look like the
    approved ``/en-in`` storefront. The path is part of the source identity for
    global brands, so crossing that locale boundary must send a listing to review.
    """
    without_scheme = (url or "").lower().strip().split("//", 1)[-1]
    url_host, _, url_path = without_scheme.partition("/")
    url_host = url_host.removeprefix("www.").split(":")[0]

    domain_host, _, domain_path = domain.lower().strip().partition("/")
    domain_host = domain_host.removeprefix("www.")
    if not _matches(url_host, domain_host):
        return False
    if not domain_path:
        return True

    path = f"/{url_path}"
    prefix = f"/{domain_path.rstrip('/')}"
    return path == prefix or path.startswith(f"{prefix}/") or path.startswith(f"{prefix}?")


@lru_cache(maxsize=1)
def _registry_domains() -> dict[str, tuple[str, ...]]:
    """Every brand's official domains, as the registry on disk records them.

    Read straight from the file rather than through BrandRegistry, because this
    is asked on every artifact and the answer changes only when a brand is
    discovered — which happens once per brand, ever.
    """
    from .config import load_config

    try:
        path = Path(load_config().brands_path)
        raw = json.loads(path.read_text("utf-8"))
    except Exception:  # noqa: BLE001 — a missing registry must not stop a build
        raw = []

    rows = raw if isinstance(raw, list) else raw.get("brands", [])
    out: dict[str, tuple[str, ...]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        brand = _norm(str(row.get("brand", "")))
        domains = tuple(d for d in (row.get("domains") or []) if isinstance(d, str))
        if brand and domains:
            out[brand] = domains
    return out


def official_domains(brand: str) -> tuple[str, ...]:
    """Where this brand speaks for itself: the static table and the registry."""
    key = _norm(brand)
    seeded = BRANDS.get(key)
    found = _registry_domains().get(key, ())
    both = (*(seeded.domains if seeded else ()), *found)
    # Aliases are brand names, not hosts, so only domains are returned — and a
    # storefront serving another market does not speak for the brand here.
    seen: set[str] = set()
    return tuple(
        d for d in both
        if not is_foreign_brand_host(d) and not (d in seen or seen.add(d))
    )


def tier(url: str, brand: str) -> int:
    """1 Indian brand site, 2 approved Indian dealer, 3 review required."""
    host = host_of(url)
    if not host:
        return 3
    if (
        any(_matches_url(url, domain) for domain in official_domains(brand))
        and is_indian_url(url, brand)
    ):
        return 1
    if (
        any(_matches(host, dealer) for dealer in TRUSTED_DEALERS)
        and is_indian_url(url, brand)
    ):
        return 2
    return 3


def may_index(url: str) -> bool:
    """Whether this host may be read purely to translate a code."""
    host = host_of(url)
    return any(_matches(host, shop) for shop in REFERENCE_INDEX)


def worst_tier(urls, brand: str) -> int:
    """The weakest link among everything a listing was built from."""
    tiers = [tier(u, brand) for u in urls if u]
    return max(tiers) if tiers else 3
