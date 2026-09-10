"""
TheCraftSync — Change Detection API

Local dev (from app/backend/):
    ..\\..\\.venv\\Scripts\\python.exe -m uvicorn main:app --reload --port 8000

Single-process (serves the built frontend too, if app/frontend/dist exists):
    uvicorn main:app --host 0.0.0.0 --port 8000

Env:
    ALLOWED_ORIGINS   comma-separated list for CORS (default "*", dev only)
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import cd_engine

MAX_UPLOAD = 25 * 1024 * 1024  # 25 MB per file
FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        cd_engine.warmup()
    except Exception as exc:  # noqa: BLE001
        print(f"[warmup] skipped: {exc}")
    yield


app = FastAPI(title="TheCraftSync Change Detection API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "methods": cd_engine.METHODS}


@app.post("/api/detect")
async def detect(
    before: UploadFile = File(...),
    after: UploadFile = File(...),
    aoi: UploadFile | None = File(None),
    method: str = Query("tinycd"),
):
    if method not in cd_engine.METHODS:
        raise HTTPException(400, f"unknown method '{method}'")

    b = await before.read()
    a = await after.read()
    if not b or not a:
        raise HTTPException(400, "both 'before' and 'after' images are required")
    if len(b) > MAX_UPLOAD or len(a) > MAX_UPLOAD:
        raise HTTPException(413, "image too large (max 25 MB each)")

    aoi_bytes = await aoi.read() if aoi is not None else None
    if aoi_bytes and len(aoi_bytes) > MAX_UPLOAD:
        raise HTTPException(413, "AOI mask too large (max 25 MB)")

    try:
        return cd_engine.run(b, a, method, aoi_bytes=aoi_bytes or None)
    except cd_engine.EngineError as exc:
        raise HTTPException(400, str(exc))


# Serve the built SPA from the same process when it's present (production build).
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="spa")
