# TheCraftSync — Change Detection

Upload a **before** and **after** image of the same place; get back a change map.
Two methods: **TinyCD** (pretrained Siamese CNN, LEVIR-CD) and **Classical** (RGB
differencing + Otsu). Optional **area of interest** (draw a polygon or upload a
mask) restricts the reported change to a region. Runs entirely on the server —
images are not stored.

```
app/
  backend/
    main.py            FastAPI routes
    cd_engine.py       the change-detection engine
    tinycd/            vendored TinyCD model + weights (self-contained)
    requirements.txt
  frontend/            Vite + React + TypeScript UI
```

## Prerequisites

- Python 3.11+ with the deps in `backend/requirements.txt`. CPU torch:
  ```
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
  pip install -r backend/requirements.txt
  ```
- Node.js 18+ (frontend only).

The model weights (`backend/tinycd/weights/levir_best.pth`, ~1.3 MB) are checked
in — nothing to download.

## Run — local dev (two terminals)

**backend** (from `app/backend/`):

```
python -m uvicorn main:app --reload --port 8000
```

**frontend** (from `app/frontend/`):

```
npm install        # first time only
npm run dev
```

Open http://localhost:5173. Vite proxies `/api/*` to `:8000`.

## Run — single process (production)

```
cd app/frontend && npm ci && npm run build      # emits app/frontend/dist
cd ../backend    && ALLOWED_ORIGINS="https://your-domain" \
  python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

When `app/frontend/dist` exists, the backend serves it at `/`, so one process
answers both the UI and the API. Set `ALLOWED_ORIGINS` to your real origin(s)
(comma-separated); it defaults to `*` for dev.

## API

`POST /api/detect?method=tinycd|classical` — multipart form:

| field | required | notes |
|---|---|---|
| `before` | yes | image |
| `after`  | yes | image (resized to `before` if sizes differ) |
| `aoi`    | no  | black/white PNG, white = analyse this region |

Response:

```jsonc
{
  "method": "tinycd",
  "method_label": "TinyCD (LEVIR-CD pretrained)",
  "changed_percent": 6.53,          // of the AOI if one was sent, else of the image
  "changed_percent_image": 6.53,    // always whole-image
  "aoi_applied": false,
  "aoi_coverage_percent": null,     // AOI area as % of the image
  "width": 1024, "height": 1024,
  "original_width": 1024, "original_height": 1024,
  "resized": false,
  "ms": 3200,
  "before_png": "data:image/png;base64,...",
  "after_png":  "data:image/png;base64,...",
  "difference_png": "data:image/png;base64,...",  // white = changed
  "overlay_png":    "data:image/png;base64,..."   // change in red; cyan = AOI edge
}
```

`GET /api/health` — liveness + available methods.

## Limits

- Images should be **pre-aligned** (same framing). Long side > 2048 px is
  downscaled before inference (classical capped at 1280).
- 25 MB max per uploaded file.
- CPU inference: TinyCD ≈ 3–5 s per 1024² pair; classical < 1 s.
