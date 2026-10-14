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
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

from PIL import Image

from .artifact import artifact_path, rebuild_index
from .cache import Cache
from .config import AgentConfig
from .http_client import HttpClient
from .background import analyse_background
from .images import (
    CUTOUT_SHOTS,
    DIAL_EDGE_FLOOR,
    MAX_ASSET_BYTES,
    dial_score,
    open_bounded,
    prepare_background,
)
from .models import WatchProduct
from .util import read_json

#: What leads, and what follows. A scene is last whatever it scored.
SHOT_ORDER = {"product": 0, "detail": 1, "packaging": 2, "wrist": 3, "lifestyle": 4}


def ordered(images: list[dict], scores: dict[str, float] | None = None) -> list[dict]:
    """The gallery in the order a shop would lay it out.

    The front of the watch leads. Which photograph that is comes from the
    picture — a dial is busy in the middle where a caseback and a bracelet are
    quiet — because the label cannot be trusted for it: on an Alba AG8Q32X1 the
    caseback and the dial were both called product shots, and the caseback was
    the more confident of the two.

    A scene is always last, whatever it scores, and among equals the order the
    shop's own gallery used is kept.
    """
    scores = scores or {}

    def rank(pair):
        index, image = pair
        kind = image.get("kind") or ""
        scene = SHOT_ORDER.get(kind, 5) >= SHOT_ORDER["wrist"]
        looks_like_a_dial = scores.get(image.get("url") or "", 0.0) >= DIAL_EDGE_FLOOR
        return (
            1 if scene else 0,            # scenes last
            0 if looks_like_a_dial else 1,  # the front of the watch first
            SHOT_ORDER.get(kind, 5),      # then the grader's view, as a tiebreak
            index,                        # then the shop's own order
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
                if not image.get("hasAlpha"):
                    continue
                if dry_run:
                    rematted += 1
                    changed = True
                elif await _reprocess(image, product["sku"], config, http):
                    rematted += 1
                    changed = True

            scores: dict[str, float] = {}
            for image in images:
                file = Path(config.image_dir) / product["sku"] / (image.get("url") or "").rsplit("/", 1)[-1]
                if file.exists():
                    try:
                        with Image.open(file) as stored:
                            scores[image.get("url") or ""] = dial_score(stored)
                    except Exception:  # noqa: BLE001
                        pass
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
