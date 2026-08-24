"""HTTP service the admin panel talks to.

The Next.js upload route proxies to this, so the browser gets the same live
progress events the CLI prints. Run it with:

    uvicorn prakash_agent.server:app --port 8077
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from .config import load_config
from .graph import run_ingestion

app = FastAPI(title="Prakash Watch Co. Catalog Agent", version="1.0.0")

ALLOWED_SUFFIXES = (".xlsx", ".csv")
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
_UNSAFE = re.compile(r"[^a-zA-Z0-9._-]")


def _check_token(provided: str | None) -> None:
    """Shared-secret guard so only the site's server can spend the shop's credit."""
    expected = os.getenv("AGENT_SERVICE_TOKEN")
    if not expected:
        return  # No token configured — local development.
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Bad service token.")


@app.get("/health")
async def health() -> dict[str, Any]:
    config = load_config()
    return {
        "ok": True,
        "hasApiKey": bool(config.api_key),
        "model": config.model,
        "visionModel": config.vision_model,
        "searchModel": config.search_model,
        "dataDir": str(config.data_dir),
    }


@app.post("/ingest")
async def ingest(
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
    force: bool = Form(False),
    limit: int | None = Form(None),
    only: str | None = Form(None),
    x_agent_token: str | None = Header(default=None),
) -> StreamingResponse:
    """Accepts a stock sheet and streams progress back as server-sent events."""
    _check_token(x_agent_token)

    name = (file.filename or "sheet.xlsx").lower()
    if not name.endswith(ALLOWED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail="Upload an .xlsx or .csv file. Legacy .xls is not supported — re-save it as .xlsx.",
        )

    payload = await file.read()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="That file is larger than 8 MB.")

    config = load_config(dry_run=dry_run, force=force)

    # Keep the uploaded sheet so a run can be traced back to its source file.
    upload_dir = Path(config.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved = upload_dir / f"{int(time.time())}-{_UNSAFE.sub('_', file.filename or 'sheet.xlsx')}"
    saved.write_bytes(payload)

    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def on_event(event: dict[str, Any]) -> None:
        queue.put_nowait(event)

    async def run() -> None:
        try:
            report = await run_ingestion(
                saved,
                config=config,
                on_event=on_event,
                limit=limit,
                only=[part.strip() for part in only.split(",") if part.strip()] if only else None,
            )
            await queue.put({"type": "report", "report": report.dump()})
        except Exception as error:  # noqa: BLE001 - surfaced to the browser
            await queue.put({"type": "error", "message": str(error) or error.__class__.__name__})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())

    async def stream() -> AsyncIterator[bytes]:
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n".encode()
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-cache, no-transform",
            # Stops proxies buffering the stream into one lump.
            "x-accel-buffering": "no",
        },
    )
