"""Translating the shop's own code into the maker's reference.

The stock sheet lists some brands under codes that belong to this shop and
nobody else: 335 of 336 Casio rows read A1149 rather than LTP-V300L-1AUDF. A
four-character code identifies nothing on the open web — it matches a power bank
— so a listing built from a search for it is a listing about the wrong object.

Shops that index both are the only place that mapping can be read, and some of
them are not shops this house vouches for. That is acceptable for this one
purpose: a reference is a fact about a watch, not a description of one. So an
index shop may answer exactly one question — "what does the maker call this?" —
and nothing but that string crosses over. Its page, its photographs, its
specifications and its price are discarded, and the listing never cites it.

The answer is then checked rather than believed. Reading the longest
reference-shaped token off a product record is a guess: asked for Casio's A1100
it offered "100PGP", and for A168 "1BDF-BLACK", both fragments of a title. So
every candidate is carried to the brand's own shop and to the dealers the shop
buys from, and only a candidate one of them actually stocks is accepted. An index
makes a claim; a trusted shop confirms it.
"""

from __future__ import annotations

import re

from .cache import Cache
from .http_client import HttpClient
from .storefront import (
    SHORT_REFERENCE,
    StoreProduct,
    _NOT_A_REFERENCE,
    _normalise,
    load_catalogue,
    match,
)
from .trust import REFERENCE_INDEX

#: A reference read off a title often keeps the punctuation that joined it to the
#: next word: "LTP-V300L-1AUDF-" is the reference with the hyphen that preceded
#: "ENTICER". Trailing and leading separators are not part of it.
_EDGES = re.compile(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$")


def candidate_references(product: StoreProduct, shop_code: str) -> list[str]:
    """Every token on this record that could be the maker's reference, best first.

    The same filtering the single-answer reader uses, but it keeps all of them
    rather than only the longest, because the longest was often wrong and the
    right one was second.
    """
    wanted = _normalise(shop_code)
    if len(wanted) >= SHORT_REFERENCE:
        return []

    out: list[str] = []
    for token in product.tokens:
        cleaned = _EDGES.sub("", token)
        normal = _normalise(cleaned)
        if (
            not normal
            or normal == wanted
            or len(normal) < SHORT_REFERENCE
            or wanted in normal
            or _NOT_A_REFERENCE.match(cleaned.upper())
            or not any(c.isalpha() for c in cleaned)
        ):
            continue
        if cleaned not in out:
            out.append(cleaned)

    # Longest first: a shop code is short by nature, and a real reference carries
    # its case, movement and colour variant in the suffix.
    return sorted(out, key=lambda t: len(_normalise(t)), reverse=True)


async def translate_code(
    brand: str,
    shop_code: str,
    trusted_hosts: list[str],
    http: HttpClient,
    cache: Cache,
) -> tuple[str | None, str]:
    """The maker's reference for a shop code, confirmed by a shop we trust.

    Returns (reference, note). None when no index knew the code, or when nothing
    an index offered could be found at the brand or at a dealer — in which case
    the shop's own code stands and the listing is built the ordinary way.
    """
    if not trusted_hosts:
        return None, ""

    tried: set[str] = set()
    for host in REFERENCE_INDEX:
        try:
            products = await load_catalogue(host, http, cache)
        except Exception:  # noqa: BLE001 — a broken index is simply not consulted
            continue
        if not products:
            continue
        found = match(products, shop_code, brand)
        if not found:
            continue

        for candidate in candidate_references(found, shop_code):
            key = _normalise(candidate)
            if key in tried:
                continue
            tried.add(key)
            for trusted in trusted_hosts:
                # Never the shop that proposed it. Asked for Casio's A1100, one
                # index offered "100PGP" and then matched its own record again —
                # a confirmation that confirms nothing. A second house has to
                # carry the reference for it to count as one.
                if trusted == host:
                    continue
                try:
                    stock = await load_catalogue(trusted, http, cache)
                except Exception:  # noqa: BLE001
                    continue
                if stock and match(stock, candidate, brand):
                    return candidate, f"{shop_code} is {candidate} — read at {host}, confirmed at {trusted}"

    return None, ""
