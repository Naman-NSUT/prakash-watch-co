"""Image stage.

A product page will hand you the payment-methods strip, a reviewer's wrist shot
and a photo of a different colourway alongside the actual product shot, and
filenames do not tell you which is which. So candidates are downloaded,
de-duplicated perceptually, then looked at by a vision model that grades whether
each one really shows the watch being listed.
"""

from __future__ import annotations

import base64
import shutil
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from .background import existing_alpha, prepare as prepare_background
from .backdrops import choose as choose_backdrop, watch_profile
from .config import AgentConfig
from .http_client import HttpClient
from .models import ProductImage, ScrapedPage, SheetRow
from .openrouter import OpenRouterClient
from .util import clamp01, sha256, uniq_by

MAX_ASSET_BYTES = 12 * 1024 * 1024
MAX_DOWNLOADS = 14
MAX_GRADED = 8
OUTPUT_WIDTH = 1600

#: No photograph is ever decoded larger than this on its long side.
#:
#: Output is 1,600 px, so anything bigger only costs memory: a 4,000 px source
#: needs 48 MB to hold, and orientation-correcting it and cutting the watch out
#: each make further copies. Measured on the $7 plan's 512 MB, one watch's worth
#: of large photographs was enough to get the whole service killed — taking the
#: public shop down with it, not just the research. A little above the output
#: size so the final resize still has pixels to work with.
WORKING_EDGE = 2000


def open_bounded(data: bytes, edge: int = WORKING_EDGE) -> Image.Image:
    """Decodes a photograph at no more than `edge` pixels on its long side.

    JPEG — most product photography — is decoded straight to a smaller scale,
    so the full-size image is never held at all. Other formats are decoded and
    then reduced at once, before anything makes a copy. Orientation is corrected
    last, on the small version.
    """
    image = Image.open(BytesIO(data))
    image.draft(image.mode, (edge, edge))
    image.load()
    if max(image.size) > edge:
        image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    return ImageOps.exif_transpose(image)


GRADE_SCHEMA = {
    "name": "image_grades",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["images"],
        "properties": {
            "images": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "index", "is_watch", "matches_model", "shot_type", "background",
                        "observed_dial_colour", "observed_strap", "observed_display",
                        "quality", "has_watermark", "reason",
                    ],
                    "properties": {
                        "index": {"type": "integer", "description": "The IMAGE number given in the prompt."},
                        "is_watch": {"type": "boolean", "description": "Does this image show a wristwatch at all?"},
                        "matches_model": {
                            "type": "number",
                            "description": "0 to 1: how well it matches the described brand, model and dial colour.",
                        },
                        "shot_type": {
                            "type": "string",
                            "enum": ["product", "wrist", "detail", "lifestyle", "packaging", "logo", "irrelevant"],
                        },
                        "background": {
                            "type": "string",
                            "enum": ["plain", "gradient", "busy"],
                            "description": (
                                "plain = a single flat colour behind the watch; gradient = a smooth studio "
                                "sweep; busy = a scene, desk, hand, props or patterned surface."
                            ),
                        },
                        # Reported rather than judged. Asking "does this match?" invites
                        # agreement; asking what is actually visible can be checked.
                        "observed_dial_colour": {
                            "type": "string",
                            "description": "The dial colour you can actually see, one or two words, e.g. 'black', 'dark blue', 'green'.",
                        },
                        "observed_strap": {
                            "type": "string",
                            "enum": ["steel bracelet", "leather", "resin", "fabric", "other", "unclear"],
                            "description": "What the strap or bracelet is made of, as visible.",
                        },
                        "observed_display": {
                            "type": "string",
                            "enum": ["analogue", "digital", "ana-digi", "unclear"],
                            "description": "Hands only, screen only, or both.",
                        },
                        "quality": {"type": "number", "description": "0 to 1: sharpness, lighting, shop suitability."},
                        "has_watermark": {"type": "boolean", "description": "Visible watermark, badge or price overlay."},
                        "reason": {"type": "string", "description": "One short sentence."},
                    },
                },
            }
        },
    },
}

#: Colour words grouped into families, so "dark green" and "green" agree while
#: "blue" and "black" do not. Ordered longest-first where prefixes overlap.
COLOUR_FAMILIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("rose-gold", ("rose gold", "rosegold", "pink gold")),
    ("gold", ("gold", "golden", "champagne")),
    ("silver", ("silver", "steel", "grey", "gray", "gunmetal", "graphite", "charcoal")),
    ("white", ("white", "ivory", "cream", "mother of pearl", "pearl")),
    ("black", ("black", "onyx", "jet")),
    ("blue", ("blue", "navy", "teal", "turquoise")),
    ("green", ("green", "olive", "khaki", "emerald")),
    ("red", ("red", "maroon", "burgundy", "crimson")),
    ("brown", ("brown", "tan", "bronze", "coffee", "chocolate")),
    ("purple", ("purple", "violet", "lilac", "lavender")),
    ("pink", ("pink", "rose", "peach")),
    ("yellow", ("yellow", "lime")),
    ("orange", ("orange",)),
    ("beige", ("beige", "sand", "taupe")),
)

#: Words in a confirmed strap specification, mapped to what a grader would see.
STRAP_FAMILIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("steel bracelet", ("stainless steel", "steel", "bracelet", "titanium", "metal", "mesh")),
    ("leather", ("leather", "calf", "croco", "suede")),
    ("resin", ("resin", "rubber", "silicone", "urethane", "plastic")),
    ("fabric", ("fabric", "nato", "nylon", "canvas", "textile")),
)


def _family(value: str | None, families: tuple[tuple[str, tuple[str, ...]], ...]) -> str | None:
    """Maps a free-text colour or material onto a family, or None if unrecognised."""
    if not value:
        return None
    lowered = value.lower()
    for name, words in families:
        if any(word in lowered for word in words):
            return name
    return None


def contradicts(expected: dict[str, str | None], grade: dict) -> str | None:
    """Compares what the grader saw against what the sources confirmed.

    Returns a reason when the photograph plainly shows a different watch. Only
    confident disagreements count: an unrecognised colour word or an "unclear"
    reading is never treated as a contradiction, because the cost of dropping a
    good photograph is far lower than the cost of publishing the wrong colourway.
    """
    want_dial = _family(expected.get("dial_colour"), COLOUR_FAMILIES)
    saw_dial = _family(grade.get("observed_dial_colour"), COLOUR_FAMILIES)
    if want_dial and saw_dial and want_dial != saw_dial:
        # Silver and white dials are genuinely hard to tell apart in a photograph.
        if {want_dial, saw_dial} != {"silver", "white"}:
            return f"dial looks {saw_dial}, but the sources say {want_dial}"

    want_strap = _family(expected.get("strap_material"), STRAP_FAMILIES)
    saw_strap = grade.get("observed_strap")
    if want_strap and saw_strap and saw_strap not in ("unclear", "other") and want_strap != saw_strap:
        return f"strap looks like {saw_strap}, but the sources say {want_strap}"

    want_display = expected.get("display")
    saw_display = grade.get("observed_display")
    if want_display and saw_display and saw_display != "unclear" and want_display != saw_display:
        return f"display looks {saw_display}, but the sources describe {want_display}"

    return None


#: Shot types that can be published, ordered by how well they sell a watch.
def dial_score(image) -> float:
    """How much this photograph looks like the front of a watch.

    A dial carries hands, markers, a date window and printed text, and all of
    that makes edges in the middle of the frame. A caseback is a brushed disc
    with its engraving around the rim, and a bracelet or a clasp is smooth metal
    — both are quiet in the centre where a dial is busy.

    What is measured is how much of the picture's detail sits in the middle
    rather than how much detail there is, because the second reading promoted a
    size-guide diagram — rulers, a credit card, annotation text — to the front of
    an Armani Exchange listing. A diagram is busy everywhere; a watch is busy in
    the middle and quiet around it.

    The grader's own label cannot be used for this. Asked about an Alba AG8Q32X1
    it called the caseback a product shot at 0.22 and the dial a product shot at
    0.14, so ordering by what it said put the back of the watch on the card.

    Measured on the pictures that showed each fault: real dials 3.81, 4.41 and
    6.81; a caseback 1.57; a size-guide diagram 1.76.
    """
    from PIL import ImageFilter, ImageStat

    try:
        grey = image.convert("L")
        width, height = grey.size
        side = int(min(width, height) * 0.30)
        if side < 8:
            return 0.0
        centre = grey.crop((
            (width - side) // 2, (height - side) // 2,
            (width + side) // 2, (height + side) // 2,
        ))
        busy_centre = ImageStat.Stat(centre.filter(ImageFilter.FIND_EDGES)).mean[0]
        busy_frame = ImageStat.Stat(grey.filter(ImageFilter.FIND_EDGES)).mean[0]
        if busy_frame <= 0.01:
            return 0.0
        return float(busy_centre / busy_frame)
    except Exception:  # noqa: BLE001
        return 0.0


#: Above this, the centre of the frame is busy enough to be a dial.
DIAL_EDGE_FLOOR = 12.0


def frame_fill(image) -> float:
    """How much of the frame the subject occupies, 0 to 1.

    A studio shot of a watch fills its frame; a watch photographed small on a
    marble slab leaves most of the canvas empty, and the slab's own texture
    makes enough edges in the middle to beat a clean dial on busyness alone.
    That is how a Titan's hero became a small angled shot on stone. Measured:
    the studio dial covers 38% of its frame, the marble shot 14%.
    """
    from PIL import ImageChops, ImageStat

    try:
        rgb = image.convert("RGB")
        width, height = rgb.size
        patch = max(4, min(width, height) // 12)
        corner = ImageStat.Stat(rgb.crop((0, 0, patch, patch))).mean[:3]
        ground = Image.new("RGB", rgb.size, tuple(int(c) for c in corner))
        difference = ImageChops.difference(rgb, ground).convert("L")
        subject = difference.point(lambda value: 0 if value <= 12 else 255)
        return float(ImageStat.Stat(subject).mean[0] / 255)
    except Exception:  # noqa: BLE001
        return 0.0


#: Below this the watch is a small object in a large picture, whatever else is
#: in the frame. Such a photograph can sit in a gallery; it should not lead one.
MIN_FRAME_FILL = 0.20


#: Shots that may be lifted off their background.
#:
#: A product shot is an object on a plinth and the cut-out is the whole point:
#: the backdrop becomes the shop's decision rather than the photographer's. A
#: lifestyle or wrist shot is a scene — a person, a sleeve, a bag — and the
#: matting has no object to find. Asked to cut one out it took the model's black
#: knitwear for background and tore a hole through her shoulder, which is what
#: reached the shop's own window. Those are left exactly as the brand shot them.
CUTOUT_SHOTS = frozenset({"product", "detail"})

SHOT_PRIORITY = {
    "product": 3.0,
    "detail": 2.0,
    "wrist": 1.5,
    "lifestyle": 1.0,
    "packaging": 0.2,
    "logo": 0.0,
    "irrelevant": 0.0,
}

PUBLISHABLE_KINDS = {"product", "wrist", "detail", "lifestyle", "packaging"}


def average_hash(image: Image.Image) -> int:
    """64-bit average hash — enough to catch the same photo served at three sizes."""
    small = image.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    pixels = list(small.getdata())
    mean = sum(pixels) / len(pixels)
    bits = 0
    for pixel in pixels:
        bits = (bits << 1) | (1 if pixel >= mean else 0)
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _is_official(page_url: str, official_hosts: list[str]) -> bool:
    host = page_url.lower().split("//")[-1].split("/")[0].removeprefix("www.")
    return any(host == official or host.endswith(f".{official}") for official in official_hosts)


def _is_trusted_page(page_url: str, official_hosts: list[str]) -> bool:
    """A page whose gallery can be believed without grading each picture.

    The brand's own site, or one of the authorised shops the catalogue is built
    from. Their product page *is* the product: every picture in the gallery is
    that reference, photographed from another angle — the caseback, the clasp,
    the box, a wrist shot.

    The grader cannot know that. Asked "is this the reference?", it sees a
    caseback and answers 0.3, and the picture is thrown away. That is why the
    average listing carried three photographs when its source page had six.

    So identity is taken from the page here, not from the picture. Whether the
    thing is a watch at all is still judged, because these pages also carry
    payment icons, delivery banners and the shop's own logo.
    """
    from .storefront import RETAILER_FEEDS

    host = page_url.lower().split("//")[-1].split("/")[0].removeprefix("www.")
    if _is_official(page_url, official_hosts):
        return True
    return any(host == shop or host.endswith(f".{shop}") for shop in RETAILER_FEEDS)


def collect_candidates(
    row: SheetRow,
    pages: list[ScrapedPage],
    official_hosts: list[str] | None = None,
    mode: str = "off",
) -> list[dict]:
    """Sheet images first, then page images by source rank.

    The brand photographed the watch, so its own pictures are the best there are.
    When official hosts are known, their images are taken alone; 'prefer' falls
    back to everything else only when that yields nothing, which is what happens
    for brands whose sites refuse us.
    """
    # A sheet's own image column has no page behind it, but a storefront gallery
    # does — and recording it stops the listing claiming "only the shop's images
    # were used" when the brand's own photographs are what it is showing.
    candidates: list[dict] = [
        {"url": url, "source_page": row.product_url, "manual": True, "rank": index}
        for index, url in enumerate(row.image_urls)
    ]

    hosts = official_hosts or []
    usable = pages
    if mode == "strict":
        # Only the brand's own photography, even if that means none at all.
        usable = [page for page in pages if _is_official(page.url, hosts)] if hosts else []
    # 'prefer' keeps every page and lets the official ones outrank the others in
    # scoring. Excluding them outright was measured to leave twelve watches with
    # no picture instead of six, because several brands refuse automated readers.

    for page_index, page in enumerate(usable):
        for image_index, url in enumerate(page.image_urls):
            # Earlier pages are better sources, and the first images on a page are
            # usually the gallery rather than "you may also like".
            candidates.append(
                {
                    "url": url,
                    "source_page": page.url,
                    "manual": False,
                    "official": _is_official(page.url, hosts),
                    "trusted": _is_trusted_page(page.url, hosts),
                    "rank": 100 + page_index * 30 + image_index,
                }
            )

    deduped = uniq_by(candidates, lambda c: c["url"].split("#")[0].split("?")[0])
    # Official pictures outrank the rest even inside a mixed 'prefer' pool.
    return sorted(deduped, key=lambda c: (not c["manual"], not c.get("official"), c["rank"]))


async def _download(candidates: list[dict], config: AgentConfig, http: HttpClient) -> list[dict]:
    """Downloads and validates, discarding anything too small or duplicated."""
    kept: list[dict] = []

    for candidate in candidates:
        if len(kept) >= MAX_DOWNLOADS:
            break

        asset = await http.get_binary(candidate["url"], MAX_ASSET_BYTES)
        if asset is None:
            continue
        data, content_type = asset
        if content_type and not content_type.lower().startswith("image/"):
            continue

        try:
            with Image.open(BytesIO(data)) as image:
                # From the header, before decoding: the real dimensions, which a
                # bounded decode would report smaller.
                width, height = image.size
                # Still decoded, so a truncated file is caught — but at a fraction
                # of full size.
                image.draft(image.mode, (WORKING_EDGE, WORKING_EDGE))
                image.load()
                if not width or not height:
                    continue
                if (image.format or "").upper() not in ("JPEG", "PNG", "WEBP", "AVIF", "GIF", "TIFF", "MPO"):
                    continue
                # Manual images are trusted at whatever size the shop supplied.
                if not candidate["manual"] and width < config.min_image_width:
                    continue
                if height < 300:
                    continue
                aspect = width / height
                if aspect < 0.35 or aspect > 3:
                    continue
                digest = average_hash(image)
        except (OSError, ValueError):
            continue  # Corrupt or unsupported bytes.

        if any(hamming(existing["hash"], digest) <= 5 for existing in kept):
            continue

        # Noted here so selection can favour shots that will cut out cleanly.
        with Image.open(BytesIO(data)) as probe:
            supplied_alpha = existing_alpha(probe) is not None

        kept.append(
            {
                **candidate,
                "bytes": data,
                "width": width,
                "height": height,
                "hash": digest,
                "supplied_alpha": supplied_alpha,
            }
        )

    return kept


async def _grade(
    images: list[dict],
    row: SheetRow,
    model_name: str | None,
    expected: dict[str, str | None],
    llm: OpenRouterClient,
) -> tuple[dict[int, dict], float]:
    """Asks a vision model to grade every downloaded image in one call."""
    if not images:
        return {}, 0.0

    known = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in expected.items() if v)
    header = (
        f"Watch being listed: {row.brand}{f' {model_name}' if model_name else ''}, "
        f"reference {row.model_number}"
        + (f".\nConfirmed from the brand's own sources — {known}" if known else "")
        + "\n\nGrade each image below. Be strict: a different colourway, a different model from the same "
        "family, a retailer's logo, a size chart or a photo of the box is not a usable product shot.\n\n"
        "Report the dial colour, strap and display you can actually SEE in each picture. Describe what is "
        "in front of you, not what the description above says — those readings are checked against the "
        "specifications, so an honest 'blue' on a watch listed as black is far more useful than agreement.\n\n"
        "Return one entry per image, using the IMAGE number given."
    )

    parts: list[dict] = [{"type": "text", "text": header}]
    for index, item in enumerate(images):
        try:
            with open_bounded(item["bytes"], 1024) as preview:
                preview.thumbnail((512, 512), Image.Resampling.LANCZOS)
                buffer = BytesIO()
                preview.convert("RGB").save(buffer, format="JPEG", quality=70)
        except (OSError, ValueError):
            continue

        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        parts.append({"type": "text", "text": f"IMAGE {index}"})
        parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}})

    data, cost = await llm.chat_json(
        model=llm.vision_model,
        max_tokens=3000,
        schema=GRADE_SCHEMA,
        messages=[
            {
                "role": "system",
                "content": (
                    "You grade product photography for an authorised watch retailer. You are conservative: "
                    "when you cannot tell whether the watch shown is the exact reference described, score "
                    "matches_model low rather than guessing."
                ),
            },
            {"role": "user", "content": parts},
        ],
    )

    grades: dict[int, dict] = {}
    for entry in data.get("images") or []:
        index = entry.get("index")
        if not isinstance(index, int) or not 0 <= index < len(images):
            continue
        grades[index] = {
            "is_watch": bool(entry.get("is_watch")),
            "matches_model": clamp01(entry.get("matches_model")),
            "shot_type": entry.get("shot_type") or "irrelevant",
            "background": entry.get("background") or "plain",
            "observed_dial_colour": str(entry.get("observed_dial_colour", "")),
            "observed_strap": str(entry.get("observed_strap", "")),
            "observed_display": str(entry.get("observed_display", "")),
            "quality": clamp01(entry.get("quality")),
            "has_watermark": bool(entry.get("has_watermark")),
            "reason": str(entry.get("reason", "")),
        }
    return grades, cost


async def process_images(
    row: SheetRow,
    sku: str,
    pages: list[ScrapedPage],
    model_name: str | None,
    expected: dict[str, str | None],
    image_alt: str,
    config: AgentConfig,
    http: HttpClient,
    llm: OpenRouterClient,
    on_stage,
    official_hosts: list[str] | None = None,
) -> dict:
    """Runs the whole image stage for one watch and returns publish-ready records."""
    candidates = collect_candidates(row, pages, official_hosts, config.official_images)
    if not candidates:
        return {"images": [], "cost_usd": 0.0, "rejected": []}

    downloaded = await _download(candidates, config, http)
    on_stage("images", f"{len(downloaded)} usable of {len(candidates)} candidate(s)")
    if not downloaded:
        return {"images": [], "cost_usd": 0.0, "rejected": []}

    gradable = downloaded[:MAX_GRADED]
    grades, cost = await _grade(gradable, row, model_name, expected, llm)

    rejected: list[dict[str, str]] = []
    scored: list[dict] = []
    # Anything that is at least a photograph of a watch, kept aside in case strict
    # grading leaves us with nothing at all.
    fallbacks: list[dict] = []

    for index, item in enumerate(gradable):
        grade = grades.get(index)
        if grade is None:
            # Manual images are published even without a grade — the shop chose them.
            if item["manual"]:
                scored.append({"item": item, "score": 2.0, "kind": "product", "match": 0.5})
            continue

        if not grade["is_watch"] or grade["shot_type"] not in PUBLISHABLE_KINDS:
            rejected.append({"url": item["url"], "reason": grade["reason"] or "not a usable product image"})
            continue

        # A watch, but not confidently this one. Held back rather than discarded:
        # if nothing better turns up, the shop would rather see the closest picture
        # with a warning than an empty listing.
        if not item["manual"] and not item.get("trusted") and grade["matches_model"] < 0.45:
            rejected.append({"url": item["url"], "reason": grade["reason"] or "does not match the reference"})
            fallbacks.append({
                "item": item,
                "score": grade["matches_model"] + grade["quality"],
                "kind": grade["shot_type"] if grade["shot_type"] in SHOT_PRIORITY else "other",
                "match": grade["matches_model"],
            })
            continue

        # The decisive check: what the grader saw, against what the sources state.
        # This is what stops a neon-yellow G-Shock being published for a blue one.
        if not item["manual"] and not item.get("trusted"):
            conflict = contradicts(expected, grade)
            if conflict:
                rejected.append({"url": item["url"], "reason": conflict})
                fallbacks.append({
                    "item": item,
                    "score": grade["matches_model"] + grade["quality"] - 0.5,
                    "kind": grade["shot_type"] if grade["shot_type"] in SHOT_PRIORITY else "other",
                    "match": grade["matches_model"],
                })
                continue

        item["vision_background"] = grade["background"]
        score = (
            SHOT_PRIORITY.get(grade["shot_type"], 0.0) * 1.5
            + grade["matches_model"] * 2
            + grade["quality"]
            + (3.0 if item["manual"] else 0.0)
            - (1.2 if grade["has_watermark"] else 0.0)
            # Prefer shots that will separate cleanly from their background, so the
            # front image of a listing is a cutout rather than someone's desk.
            + (2.0 if item.get("official") else 0.0)
            # A shop the catalogue is actually built from, photographing its own
            # stock. Below the brand's photography, above a stranger's.
            + (1.2 if item.get("trusted") and not item.get("official") else 0.0)
            + (1.5 if item.get("supplied_alpha") else 0.0)
            + (0.8 if grade["background"] == "plain" else 0.0)
            - (0.6 if grade["background"] == "busy" else 0.0)
        )
        scored.append({"item": item, "score": score, "kind": grade["shot_type"], "match": grade["matches_model"]})

    scored.sort(key=lambda entry: entry["score"], reverse=True)
    scored = scored[: config.max_images]

    # Every watch should carry a picture. When strict grading rejected everything,
    # publish the closest one found and flag the listing so a human confirms it
    # before it goes live — an unverified photograph behind a warning is more use
    # to the shop than a blank card, and the flag keeps it out of the shop window.
    provisional = False
    if not scored and fallbacks:
        fallbacks.sort(key=lambda entry: entry["score"], reverse=True)
        scored = [fallbacks[0]]
        provisional = True
        on_stage("images", "nothing confirmed — keeping the closest match for review")

    output_dir = Path(config.image_dir) / sku
    if config.image_mode == "download" and scored:
        # Start clean, so a re-run that keeps fewer images does not leave the old
        # ones behind under names nothing points at any more.
        shutil.rmtree(output_dir, ignore_errors=True)
        output_dir.mkdir(parents=True, exist_ok=True)

    images: list[ProductImage] = []
    for position, entry in enumerate(scored):
        item = entry["item"]
        alt = image_alt if (position == 0 and image_alt) else (
            f"{row.brand} {model_name or row.model_number} — {entry['kind']} shot"
        )

        if config.image_mode == "reference":
            images.append(
                ProductImage(
                    url=item["url"],
                    width=item["width"],
                    height=item["height"],
                    alt=alt,
                    kind=entry["kind"],
                    blur_data_url=None,
                    source_url=item["url"],
                    source_page=item["source_page"],
                    match_score=entry["match"],
                )
            )
            continue

        try:
            with open_bounded(item["bytes"]) as oriented:

                # Lift the watch off whatever it was shot against, so the backdrop
                # stays the shop's decision rather than the photographer's.
                main, has_alpha, backdrop = prepare_background(
                    oriented,
                    size=config.image_canvas,
                    background=config.image_background,
                    attempt_cutout=config.image_cutout and entry["kind"] in CUTOUT_SHOTS,
                    vision_background=item.get("vision_background"),
                )

                # The filename carries a hash of the picture itself. Re-running the
                # agent replaces the artwork, and without this the URL would be
                # unchanged — so browsers and CDNs would go on serving the previous
                # version, which is exactly how a cut-out watch keeps appearing
                # with the white background it was published with yesterday.
                encoded = BytesIO()
                main.save(encoded, format="WEBP", quality=82)
                payload = encoded.getvalue()
                file_name = f"{position + 1:02d}-{sha256(payload)[:8]}.webp"
                (output_dir / file_name).write_bytes(payload)

                blur = main.convert("RGB")
                blur.thumbnail((16, 16), Image.Resampling.LANCZOS)
                blur_buffer = BytesIO()
                blur.save(blur_buffer, format="WEBP", quality=40)
                blur_encoded = base64.b64encode(blur_buffer.getvalue()).decode("ascii")

                images.append(
                    ProductImage(
                        url=f"{config.image_url_base}/{sku}/{file_name}",
                        width=main.width,
                        height=main.height,
                        alt=alt,
                        kind=entry["kind"],
                        blur_data_url=f"data:image/webp;base64,{blur_encoded}",
                        source_url=item["url"],
                        source_page=item["source_page"],
                        match_score=entry["match"],
                        has_alpha=has_alpha,
                        background=backdrop,
                    )
                )
        except (OSError, ValueError):
            rejected.append({"url": item["url"], "reason": "failed to encode"})

    # Match a backdrop to the watch's own colour. Only meaningful once the watch
    # has been cut out — an uncut photograph carries its own background and would
    # simply cover whatever we put behind it. Taken from a published photograph,
    # since that is the one the site will actually show.
    backdrop_id: str | None = None
    # The front of the watch leads the gallery.
    #
    # Ranking by the grader's confidence is what put a caseback on a card: asked
    # about a Tissot Ballade it scored the back 0.95 and the dial 0.05. So the
    # order is settled by reading the pictures — a dial is busy in the middle
    # where a caseback and a bracelet are quiet — and a scene goes last whatever
    # it scored. Among equals the order they arrived in is kept, which is the
    # shop's own gallery order.
    if len(images) > 1:
        faces: dict[str, tuple[float, float]] = {}
        for image in images:
            file = Path(config.image_dir) / sku / image.url.rsplit("/", 1)[-1]
            if file.exists():
                try:
                    with Image.open(file) as stored:
                        faces[image.url] = (dial_score(stored), frame_fill(stored))
                except Exception:  # noqa: BLE001
                    pass
        images = [
            image for _, image in sorted(
                enumerate(images),
                key=lambda pair: (
                    1 if pair[1].kind in ("wrist", "lifestyle", "packaging") else 0,
                    0 if faces.get(pair[1].url, (0.0, 0.0))[1] >= MIN_FRAME_FILL else 1,
                    -faces.get(pair[1].url, (0.0, 0.0))[0],
                    pair[0],
                ),
            )
        ]

    if images and images[0].has_alpha:
        try:
            with Image.open(Path(config.image_dir) / sku / images[0].url.rsplit("/", 1)[-1]) as primary:
                backdrop_id, reason = choose_backdrop(watch_profile(primary))
                on_stage("backdrop", reason)
        except (OSError, ValueError):
            backdrop_id = None

    on_stage("images", f"{len(images)} kept, {len(rejected)} rejected")
    return {
        "images": images,
        "cost_usd": cost,
        "rejected": rejected,
        "backdrop_id": backdrop_id,
        "provisional": provisional and bool(images),
    }
