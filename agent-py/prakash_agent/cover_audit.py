"""Classify and repair the lead photograph across an existing catalogue.

Newly researched watches get a camera-view classification in ``images.py``.
This command brings older artifacts up to the same contract without downloading
or re-encoding their photographs. It is resumable: model replies are cached and
an applied artifact with a non-zero view confidence is skipped on the next run.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import tarfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image
from PIL.PngImagePlugin import PngInfo

from .artifact import rebuild_index
from .cache import Cache
from .config import AgentConfig, load_config
from .images import COVER_VIEW_ORDER, MIN_VIEW_CONFIDENCE, open_bounded
from .models import WatchProduct
from .openrouter import OpenRouterClient, OpenRouterError
from .tidy import ordered
from .util import clamp01, now_iso, read_json, write_json

VIEW_AUDIT_SCHEMA = {
    "name": "watch_camera_views",
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
                    "required": ["index", "view", "confidence", "reason"],
                    "properties": {
                        "index": {"type": "integer"},
                        "view": {
                            "type": "string",
                            "enum": ["front", "three-quarter", "side", "back", "unclear"],
                        },
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "reason": {"type": "string"},
                    },
                },
            }
        },
    },
}


def _stored_path(config: AgentConfig, product: WatchProduct, url: str) -> Path:
    """Resolve the filename from a /media/<sku>/<file> URL without trusting it."""
    name = url.rsplit("/", 1)[-1]
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        return Path(config.image_dir) / "__missing__"
    return Path(config.image_dir) / product.sku / name


def _preview(path: Path) -> str | None:
    try:
        with open_bounded(path.read_bytes(), 1024) as image:
            image.thumbnail((512, 512), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            image.convert("RGB").save(buffer, format="JPEG", quality=70)
    except (OSError, ValueError):
        return None
    return base64.b64encode(buffer.getvalue()).decode("ascii")


async def classify_views(
    product: WatchProduct,
    config: AgentConfig,
    llm: OpenRouterClient,
) -> tuple[dict[int, dict[str, Any]], float, list[int]]:
    """Return confident camera views keyed by the original gallery position."""
    parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"Arrange the gallery for {product.brand} {product.model_name or ''}, reference "
                f"{product.model_number}. Classify the camera view of the watch in every image.\n\n"
                "front: the dial is squarely visible and is the main face of the image.\n"
                "three-quarter: the dial is still clearly visible and dominant, but photographed at an angle.\n"
                "side: the dial is mostly edge-on; the case edge, crown or pushers dominate.\n"
                "back: the caseback, underside, clasp or rear of the bracelet dominates.\n"
                "unclear: the watch or its angle cannot be determined.\n\n"
                "Judge only the camera view. Do not infer the answer from the filename or product description. "
                "Use a low confidence when the dial/caseback is obscured. Return one entry for each IMAGE number."
            ),
        }
    ]
    positions: list[int] = []
    missing: list[int] = []
    for index, image in enumerate(product.images):
        encoded = _preview(_stored_path(config, product, image.url))
        if encoded is None:
            missing.append(index)
            continue
        positions.append(index)
        parts.append({"type": "text", "text": f"IMAGE {index}"})
        parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}})

    if not positions:
        return {}, 0.0, missing

    data, cost = await llm.chat_json(
        model=llm.vision_model,
        max_tokens=max(500, 180 * len(positions)),
        schema=VIEW_AUDIT_SCHEMA,
        messages=[
            {
                "role": "system",
                "content": (
                    "You classify wristwatch product photographs for a retail catalogue. Camera angle is a "
                    "visual fact. Be conservative and use unclear when the face or back cannot be seen well enough."
                ),
            },
            {"role": "user", "content": parts},
        ],
    )

    result: dict[int, dict[str, Any]] = {}
    for entry in data.get("images") or []:
        index = entry.get("index")
        if not isinstance(index, int) or index not in positions:
            continue
        raw_view = entry.get("view")
        confidence = clamp01(entry.get("confidence"))
        view = raw_view if raw_view in COVER_VIEW_ORDER else "unclear"
        if confidence < MIN_VIEW_CONFIDENCE:
            view = "unclear"
        result[index] = {
            "view": view,
            "confidence": confidence,
            "reason": str(entry.get("reason") or ""),
        }
    return result, cost, missing


def _backup(config: AgentConfig, stamp: str) -> Path:
    target = Path(config.report_dir) / f"cover-audit-{stamp}-catalog.tar.gz"
    target.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(target, "w:gz") as archive:
        for path in sorted(Path(config.data_dir).glob("*.json")):
            archive.add(path, arcname=f"catalog/{path.name}")
    return target


async def run_cover_audit(
    config: AgentConfig,
    *,
    apply: bool = False,
    limit: int | None = None,
    only: set[str] | None = None,
    force: bool = False,
    concurrency: int = 3,
) -> dict[str, Any]:
    files = sorted(path for path in Path(config.data_dir).glob("*.json") if path.name != "index.json")
    if only:
        wanted = {value.casefold() for value in only}
        files = [path for path in files if path.stem.casefold() in wanted]
    if limit is not None:
        files = files[: max(0, limit)]

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    backup = _backup(config, stamp) if apply else None
    report_path = Path(config.report_dir) / f"cover-audit-{stamp}.json"
    checkpoint_path = Path(config.report_dir) / f"cover-audit-{stamp}.jsonl"
    status_path = Path(config.report_dir) / "cover-audit-status.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)

    cache = Cache(Path(config.cache_dir), enabled=config.cache)
    llm = OpenRouterClient(config, cache)
    results: list[dict[str, Any]] = []
    changed = reordered = skipped = missing_files = failures = no_front = 0

    def publish_status(state: str, processed: int, error: str | None = None) -> None:
        payload = {
            "state": state,
            "startedAt": stamp,
            "updatedAt": now_iso(),
            "total": len(files),
            "processed": processed,
            "concurrency": concurrency,
            "classified": changed,
            "galleriesReordered": reordered,
            "noConfidentFront": no_front,
            "missingImageFiles": missing_files,
            "skipped": skipped,
            "failures": failures,
            "costUsd": round(llm.spent_usd, 6),
            "error": error,
        }
        write_json(status_path, payload)

        # The shop's existing /media route can expose images but deliberately
        # refuses JSON. A two-pixel PNG gives operations a safe progress beacon
        # without adding a public API: the counters live in PNG metadata and the
        # pixel colour shows running/complete/failed at a glance. No SKU, source
        # URL, path or credential is included.
        try:
            public = {key: value for key, value in payload.items() if key != "error"}
            metadata = PngInfo()
            metadata.add_text("coverAudit", json.dumps(public, separators=(",", ":")))
            colour = {"running": "#d79a2b", "complete": "#2f8f5b", "failed": "#b54141"}.get(
                state, "#777777"
            )
            media = Path(config.image_dir)
            media.mkdir(parents=True, exist_ok=True)
            temporary = media / ".cover-audit-status.png.tmp"
            Image.new("RGB", (2, 2), colour).save(temporary, format="PNG", pnginfo=metadata)
            temporary.replace(media / "cover-audit-status.png")
        except OSError as status_error:
            print(f"Could not publish cover-audit media status: {status_error}", flush=True)

    last_reported = 0

    def progress(number: int) -> None:
        nonlocal last_reported
        if number == len(files) or number - last_reported >= 10:
            last_reported = number
            publish_status("running", number)
            print(
                f"[{number}/{len(files)}] reordered {reordered}; no front {no_front}; "
                f"missing files {missing_files}; spent ${llm.spent_usd:.4f}",
                flush=True,
            )

    async def settle(
        number: int,
        path: Path,
        product: WatchProduct,
        before: list[str],
        previous: dict[str, tuple[str, float]],
        task: asyncio.Task[tuple[dict[int, dict[str, Any]], float, list[int]]],
    ) -> None:
        nonlocal changed, reordered, missing_files, no_front
        grades, cost, missing = await task
        missing_files += len(missing)
        for index, image in enumerate(product.images):
            grade = grades.get(index)
            if grade is None:
                continue
            image.view = grade["view"]
            image.view_confidence = grade["confidence"]

        has_face = any(image.view in {"front", "three-quarter"} for image in product.images)
        if has_face and len(product.images) > 1:
            dumped = [image.dump() for image in product.images]
            product.images = [type(product.images[0]).model_validate(image) for image in ordered(dumped)]
        elif not has_face:
            no_front += 1

        after = [image.url for image in product.images]
        did_reorder = before != after
        did_change = did_reorder or any(
            previous.get(image.url) != (image.view, image.view_confidence)
            for image in product.images
        )
        if grades:
            changed += 1
        if did_reorder:
            reordered += 1

        if apply and grades:
            write_json(path, product.dump())

        item = {
            "sku": product.sku,
            "status": "updated" if grades else "unreadable-images",
            "reordered": did_reorder,
            "changed": did_change,
            "before": before[0] if before else None,
            "after": after[0] if after else None,
            "views": [
                {"url": image.url, "view": image.view, "confidence": image.view_confidence}
                for image in product.images
            ],
            "missing": missing,
            "costUsd": round(cost, 6),
        }
        results.append(item)
        with checkpoint_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(item, ensure_ascii=False) + "\n")
        progress(number)

    publish_status("running", 0)
    pending: list[
        tuple[
            int,
            Path,
            WatchProduct,
            list[str],
            dict[str, tuple[str, float]],
            asyncio.Task[tuple[dict[int, dict[str, Any]], float, list[int]]],
        ]
    ] = []
    try:
        await llm.prepare()
        for number, path in enumerate(files, start=1):
            raw = read_json(path)
            try:
                product = WatchProduct.model_validate(raw)
            except Exception as error:  # noqa: BLE001
                item = {"sku": path.stem, "status": "invalid", "error": str(error)}
                results.append(item)
                failures += 1
                with checkpoint_path.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(item, ensure_ascii=False) + "\n")
                progress(number)
                continue

            if not product.images:
                item = {"sku": product.sku, "status": "no-images"}
                results.append(item)
                skipped += 1
                progress(number)
                continue
            if not force and all(image.view_confidence > 0 for image in product.images):
                item = {"sku": product.sku, "status": "already-audited"}
                results.append(item)
                skipped += 1
                progress(number)
                continue
            if config.budget_usd and llm.spent_usd >= config.budget_usd:
                raise RuntimeError(f"Cover audit reached its ${config.budget_usd:.2f} budget.")

            before = [image.url for image in product.images]
            previous = {
                image.url: (image.view, image.view_confidence)
                for image in product.images
            }
            task = asyncio.create_task(classify_views(product, config, llm))
            pending.append((number, path, product, before, previous, task))
            if len(pending) >= max(1, concurrency):
                await settle(*pending.pop(0))

        for context in pending:
            await settle(*context)
    except Exception as error:
        publish_status("failed", len(results), str(error))
        raise
    finally:
        await llm.aclose()

    if apply and changed:
        rebuild_index(config)

    report = {
        "startedAt": stamp,
        "finishedAt": now_iso(),
        "apply": apply,
        "model": llm.vision_model,
        "lookedAt": len(files),
        "classified": changed,
        "galleriesReordered": reordered,
        "noConfidentFront": no_front,
        "missingImageFiles": missing_files,
        "skipped": skipped,
        "failures": failures,
        "costUsd": round(llm.spent_usd, 6),
        "backup": str(backup) if backup else None,
        "results": results,
    }
    write_json(report_path, report)
    publish_status("complete", len(files))
    print(f"Report: {report_path}")
    if backup:
        print(f"Backup: {backup}")
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Classify and repair catalog cover-image order.")
    parser.add_argument("--apply", action="store_true", help="Write artifacts and rebuild the catalog index")
    parser.add_argument("--limit", type=int, help="Only inspect the first N artifacts")
    parser.add_argument("--only", help="Comma-separated SKUs to inspect")
    parser.add_argument("--force", action="store_true", help="Reclassify artifacts already carrying confidence")
    parser.add_argument("--no-cache", action="store_true", help="Ignore cached model replies")
    parser.add_argument("--model", help="Override the vision model")
    parser.add_argument("--budget", type=float, help="Maximum model spend in USD")
    parser.add_argument("--concurrency", type=int, default=3, help="Galleries classified at once")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    overrides: dict[str, Any] = {"cache": not args.no_cache}
    if args.model:
        overrides["vision_model"] = args.model
    if args.budget is not None:
        overrides["budget_usd"] = args.budget
    config = load_config(**overrides)
    only = {part.strip() for part in args.only.split(",") if part.strip()} if args.only else None
    try:
        asyncio.run(
            run_cover_audit(
                config,
                apply=args.apply,
                limit=args.limit,
                only=only,
                force=args.force,
                concurrency=max(1, args.concurrency),
            )
        )
    except (OpenRouterError, RuntimeError) as error:
        print(f"Cover audit could not finish: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
