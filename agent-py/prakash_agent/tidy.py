"""Putting the galleries right: what leads, and what was cut out that should not have been.

Two faults, both visible on the shop's own cards.

The first is order. A gallery was arranged by how confidently the grader thought
each picture showed the reference, and on a Tissot Ballade it scored the caseback
0.95 and the dial 0.05 — so the card led with the back of the watch. Confidence
is not composition. A listing now leads with a product shot, then details, and a
scene last, which is the order a shop would lay photographs on the counter.

The second is the cut-out. Every lifestyle shot in the catalogue had its
background removed, because the rule was applied to all photographs rather than
to objects on a plinth. On a model in black knitwear the matting took the
clothing for background and tore a hole through her shoulder. Those are fetched
again and set down whole, exactly as the brand shot them.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image

from .artifact import artifact_path, rebuild_index
from .background import analyse_background
from .cache import Cache
from .config import AgentConfig
from .http_client import HttpClient
from .images import (
    COVER_VIEW_ORDER,
    MAX_ASSET_BYTES,
    dial_score,
    open_bounded,
    prepare_background,
)
from .models import WatchProduct
from .util import read_json

#: What leads, and what follows. A scene is last whatever it scored.
SHOT_ORDER = {"product": 0, "detail": 1, "packaging": 2, "wrist": 3, "lifestyle": 4}


def ordered(images: list[dict], scores: dict[str, tuple[float, bool]] | None = None) -> list[dict]:
    """The gallery in the order a shop would lay it out.

    The front of the watch leads. New listings carry the camera view reported by
    the vision grader, which distinguishes front and three-quarter photographs
    from side and back views. Older listings have an "unclear" view and retain
    the measured dial/studio fallback below.

    Two readings decide it, because neither is enough alone.

    Where the detail sits tells a dial from a caseback and from a size-guide
    diagram: a watch is busy in the middle and quiet around it, while a caseback
    and a diagram are evenly busy. But a watch photographed small on a marble
    slab reads as busy-in-the-middle too, since the stone sits outside the
    centre crop. So the ground is read as well, from the photograph as the shop
    published it: a watch on a plain ground may lead, a watch on a surface may
    not. How much of the frame the watch fills cannot be used for this — a white
    Armani Exchange on white measures 5.7% full and is the best photograph in
    its listing.

    The comparison is within the listing rather than against a fixed bar. A bar
    is the wrong instrument: 174 listings had their best photograph at 10 to 12
    against a floor of 12, and a watch with a plain dial and no date is simply
    quieter than a chronograph. The dial does not have to be busy in absolute
    terms — only busier than this watch's own caseback and bracelet, which it
    always is.

    A face-on photograph always beats a side or back view. Among photographs of
    the same camera view, a clean product shot beats a scene, and the shop's own
    order settles any remaining tie.
    """
    scores = scores or {}

    def rank(pair):
        index, image = pair
        url = image.get("url") or ""
        kind = image.get("kind") or ""
        view = image.get("view") or "unclear"
        scene = SHOT_ORDER.get(kind, 5) >= SHOT_ORDER["wrist"]
        busy, studio = scores.get(url, (0.0, False))
        return (
            COVER_VIEW_ORDER.get(view, COVER_VIEW_ORDER["unclear"]),
            1 if scene else 0,        # among equal views, scenes last
            0 if studio else 1,       # then anything shot on a surface rather than a plain ground
            -busy,                    # then the picture whose detail is in the middle: the dial
            index,                    # then the shop's own order
        )

    return [image for _, image in sorted(enumerate(images), key=rank)]


async def _looks_isolated(image: dict, http: HttpClient) -> bool:
    """Whether the original picture holds the watch and nothing else.

    Read from the source rather than from what is stored, because what is stored
    has already been set on the shop's canvas and its border says nothing about
    the photograph it came from.
    """
    source = image.get("sourceUrl")
    if not source:
        return True  # nothing to re-read; leave it alone
    got = await http.get_binary(source, MAX_ASSET_BYTES)
    if not got:
        return True
    try:
        with open_bounded(got[0]) as original:
            return analyse_background(original).is_plain
    except Exception:  # noqa: BLE001
        return True


async def _reprocess(
    image: dict,
    sku: str,
    config: AgentConfig,
    http: HttpClient,
) -> bool:
    """Fetches a scene again and sets it down without the matting. True if replaced."""
    source = image.get("sourceUrl")
    if not source:
        return False
    got = await http.get_binary(source, MAX_ASSET_BYTES)
    if not got:
        return False
    payload, content_type = got
    if (content_type and not content_type.lower().startswith("image/")) or len(payload) < 4096:
        return False

    out_dir = Path(config.image_dir) / sku
    try:
        with open_bounded(payload) as oriented:
            # The real pipeline, not a special case: the corrected guards in
            # background.py decide whether this picture may be cut out at all.
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

            old_name = (image.get("url") or "").rsplit("/", 1)[-1]
            position = old_name.split("-", 1)[0] if "-" in old_name else "01"
            name = f"{position}-{sha256(blob).hexdigest()[:8]}.webp"
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / name).write_bytes(blob)
            if old_name and old_name != name:
                (out_dir / old_name).unlink(missing_ok=True)

            blur = main.convert("RGB")
            blur.thumbnail((16, 16), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            blur.save(buffer, format="WEBP", quality=40)

            image["url"] = f"{config.image_url_base}/{sku}/{name}"
            image["width"], image["height"] = main.width, main.height
            image["hasAlpha"] = bool(has_alpha)
            image["background"] = backdrop
            image["blurDataURL"] = "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
            return True
    except Exception:  # noqa: BLE001
        return False


async def run_tidy(
    config: AgentConfig,
    *,
    limit: int | None = None,
    dry_run: bool = False,
    reorder_only: bool = False,
    on_each: Callable[[str, dict], None] | None = None,
) -> dict[str, Any]:
    data_dir = Path(config.data_dir)
    index = read_json(data_dir / "index.json") or []
    wanted = [e for e in index if e.get("status") in ("ready", "needs_review")]
    if limit:
        wanted = wanted[:limit]

    cache = Cache(Path(config.cache_dir))
    http = HttpClient(config, cache)
    reordered = rematted = touched = 0
    try:
        for entry in wanted:
            path = artifact_path(config, entry["sku"])
            product = read_json(path)
            if not product:
                continue
            images = list(product.get("images") or [])
            if not images:
                continue

            changed = False

            # Every photograph that was cut out is put back through the pipeline
            # as it now stands, and the corrected guards decide for themselves:
            # the border test refuses a scene, and the kept-fraction floor
            # refuses a fill that ate a white watch. Whatever comes out is what
            # is stored, so this needs no list of which fault applied to which
            # picture.
            for image in images:
                if reorder_only or not image.get("hasAlpha"):
                    continue
                if dry_run:
                    rematted += 1
                    changed = True
                elif await _reprocess(image, product["sku"], config, http):
                    rematted += 1
                    changed = True

            scores: dict[str, tuple[float, bool]] = {}
            for image in images:
                file = Path(config.image_dir) / product["sku"] / (image.get("url") or "").rsplit("/", 1)[-1]
                if not file.exists():
                    continue
                try:
                    with Image.open(file) as stored:
                        busy = dial_score(stored)
                except Exception:  # noqa: BLE001
                    continue
                # Read from the photograph as the shop published it, because the
                # stored copy sits on the shop's own canvas and its ground says
                # nothing about where the watch was actually shot.
                studio = True
                source = image.get("sourceUrl")
                if source:
                    got = await http.get_binary(source, MAX_ASSET_BYTES)
                    if got:
                        try:
                            with open_bounded(got[0]) as original:
                                studio = analyse_background(original).is_plain
                        except Exception:  # noqa: BLE001
                            pass
                scores[image.get("url") or ""] = (busy, studio)
            new_order = ordered(images, scores)
            if [i.get("url") for i in new_order] != [i.get("url") for i in images]:
                images = new_order
                reordered += 1
                changed = True

            if changed:
                touched += 1
                product["images"] = images
                if on_each:
                    on_each(product["sku"], {"lead": images[0].get("kind")})
                if not dry_run:
                    WatchProduct.model_validate(product)
                    path.write_text(json.dumps(product, indent=2, ensure_ascii=False) + "\n", "utf-8")
    finally:
        await http.aclose()

    if not dry_run and touched:
        rebuild_index(config)
    return {"looked_at": len(wanted), "listings_changed": touched,
            "galleries_reordered": reordered, "scenes_set_down_whole": rematted}
