import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

type Method = "tinycd" | "classical";

interface DetectResult {
  method: Method;
  method_label: string;
  changed_percent: number;
  changed_percent_image: number;
  aoi_applied: boolean;
  aoi_coverage_percent: number | null;
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  resized: boolean;
  ms: number;
  before_png: string;
  after_png: string;
  difference_png: string;
  overlay_png: string;
}

const METHODS: { id: Method; name: string; blurb: string }[] = [
  {
    id: "tinycd",
    name: "TinyCD",
    blurb:
      "Siamese CNN pretrained on LEVIR-CD. Recognises new structures semantically and ignores season, lighting, and shadows.",
  },
  {
    id: "classical",
    name: "Classical",
    blurb:
      "Histogram-matched RGB differencing with an Otsu threshold. No model — fast, but flags any large pixel change.",
  },
];

/* ------------------------------------------------------------------ */

function useObjectUrl(file: File | null) {
  return useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */

// Base URL of the backend. Empty = same origin (local dev via the Vite proxy,
// or single-process hosting). Set VITE_API_BASE to the deployed API URL when
// the frontend and backend live on different hosts.
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

/* ------------------------------------------------------------------ */

export default function App() {
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);
  const [method, setMethod] = useState<Method>("tinycd");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(
    null,
  );
  const [health, setHealth] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [aoiBlob, setAoiBlob] = useState<Blob | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetch(`${API_BASE}/api/health`)
        .then((r) => (r.ok ? "online" : "offline"))
        .catch(() => "offline" as const)
        .then((s) => alive && setHealth(s as "online" | "offline"));
    ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const canRun = !!beforeFile && !!afterFile && !busy && health !== "offline";

  const run = useCallback(async () => {
    if (!beforeFile || !afterFile) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("before", beforeFile);
      fd.append("after", afterFile);
      if (aoiBlob) fd.append("aoi", aoiBlob, "aoi.png");
      const res = await fetch(`${API_BASE}/api/detect?method=${method}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? `Request failed (${res.status})`);
      }
      setResult((await res.json()) as DetectResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [beforeFile, afterFile, method, aoiBlob]);

  const reset = () => {
    setBeforeFile(null);
    setAfterFile(null);
    setAoiBlob(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path
                d="M4 8.5 12 4l8 4.5M4 8.5v7L12 20l8-4.5v-7M4 8.5 12 13l8-4.5M12 13v7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="brand-name">
            TheCraft<span className="brand-accent">Sync</span>
          </span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-partner">HRDA</span>
        </div>
        <div className="masthead-right">
          <span className="masthead-product">Change Detection</span>
          <span className={`health health--${health}`}>
            <span className="health-dot" />
            {health === "checking"
              ? "connecting"
              : health === "online"
                ? "engine online"
                : "engine offline"}
          </span>
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <h1>
            Detect what changed between <em>two images</em> of the same place.
          </h1>
          <p>
            Upload an aligned <strong>before</strong> and <strong>after</strong> pair.
            The engine returns a pixel-level change map — what was built, cleared,
            or removed — as downloadable layers.
          </p>
        </section>

        <section className="panel">
          <div className="panel-section">
            <span className="section-label">01 — Method</span>
            <div className="method-toggle" role="tablist" aria-label="Detection method">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={method === m.id}
                  className={`method-tab ${method === m.id ? "is-active" : ""}`}
                  onClick={() => setMethod(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <p className="method-desc">
              {METHODS.find((m) => m.id === method)!.blurb}
            </p>
          </div>

          <div className="panel-section">
            <span className="section-label">02 — Images</span>
            <div className="slots">
              <UploadSlot
                label="Before"
                file={beforeFile}
                onFile={setBeforeFile}
              />
              <span className="slots-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                  <path
                    d="M5 12h14m-6-6 6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <UploadSlot label="After" file={afterFile} onFile={setAfterFile} />
            </div>
          </div>

          <div className="panel-section">
            <span className="section-label">03 — Area of interest (optional)</span>
            <AoiPicker beforeFile={beforeFile} onChange={setAoiBlob} />
          </div>

          <div className="actions">
            <button className="btn btn--primary" onClick={run} disabled={!canRun}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? "Detecting…" : "Detect changes"}
            </button>
            {(beforeFile || afterFile || result) && (
              <button
                className="btn btn--ghost"
                onClick={reset}
                disabled={busy}
              >
                Clear
              </button>
            )}
            {health === "offline" && (
              <span className="hint-inline">
                Start the backend on port 8000 to run detection.
              </span>
            )}
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        {busy && (
          <section className="panel results-skeleton" aria-hidden="true">
            <div className="sk-bar" />
            <div className="sk-grid">
              <div className="sk-cell" />
              <div className="sk-cell" />
              <div className="sk-cell" />
              <div className="sk-cell" />
            </div>
          </section>
        )}

        {result && !busy && (
          <section className="panel results">
            <div className="panel-section">
              <span className="section-label">04 — Result</span>
              <div className="result-summary">
                <ChangedGauge
                  percent={result.changed_percent}
                  sub={
                    result.aoi_applied ? "of AOI changed" : "of image changed"
                  }
                />
                <dl className="result-meta">
                  <div>
                    <dt>Method</dt>
                    <dd>{result.method_label}</dd>
                  </div>
                  {result.aoi_applied && (
                    <div>
                      <dt>AOI</dt>
                      <dd>
                        {result.aoi_coverage_percent}% of image
                        <span className="meta-sub">
                          {" "}
                          · whole image {result.changed_percent_image}% changed
                        </span>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Resolution</dt>
                    <dd>
                      {result.width}&times;{result.height}
                      {result.resized && (
                        <span className="meta-sub">
                          {" "}
                          from {result.original_width}&times;
                          {result.original_height}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Compute</dt>
                    <dd>{result.ms} ms</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="panel-section">
              <span className="section-label">Before / after</span>
              <CompareSlider
                before={result.before_png}
                after={result.overlay_png}
                afterLabel="detected change"
              />
            </div>

            <div className="panel-section">
              <span className="section-label">Layers</span>
              <div className="layer-grid">
                {[
                  { title: "Before", src: result.before_png, name: "before" },
                  { title: "After", src: result.after_png, name: "after" },
                  {
                    title: "Difference",
                    caption: "white = changed",
                    src: result.difference_png,
                    name: "difference",
                  },
                  {
                    title: "Overlay",
                    caption: "change in red over “after”",
                    src: result.overlay_png,
                    name: "difference_overlay",
                  },
                ].map((c) => (
                  <figure key={c.name} className="layer-card">
                    <div className="layer-head">
                      <figcaption>
                        <span className="layer-title">{c.title}</span>
                        {c.caption && (
                          <span className="layer-caption">{c.caption}</span>
                        )}
                      </figcaption>
                      <a className="layer-dl" href={c.src} download={`${c.name}.png`}>
                        Download
                      </a>
                    </div>
                    <button
                      className="layer-img"
                      onClick={() => setLightbox({ src: c.src, title: c.title })}
                      aria-label={`Enlarge ${c.title}`}
                    >
                      <img src={c.src} alt={c.title} />
                    </button>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <span className="footer-brand">
          TheCraft<span className="brand-accent">Sync</span>
        </span>
        <span className="brand-divider" aria-hidden="true" />
        <span className="brand-partner">HRDA</span>
      </footer>

      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.title}
          onClick={() => setLightbox(null)}
        >
          <button className="lightbox-close" aria-label="Close">
            &times;
          </button>
          <img src={lightbox.src} alt={lightbox.title} />
          <span className="lightbox-title">{lightbox.title}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function UploadSlot({
  label,
  file,
  onFile,
}: {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [dims, setDims] = useState<string | null>(null);
  const url = useObjectUrl(file);

  useEffect(() => {
    if (!url) {
      setDims(null);
      return;
    }
    const img = new Image();
    img.onload = () => setDims(`${img.naturalWidth}×${img.naturalHeight}`);
    img.src = url;
  }, [url]);

  const take = (f: File | undefined | null) => {
    if (f && f.type.startsWith("image/")) onFile(f);
  };

  return (
    <div
      className={`slot ${drag ? "is-drag" : ""} ${url ? "has-image" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        take(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => take(e.target.files?.[0])}
      />
      <span className="slot-label">{label}</span>

      {url ? (
        <>
          <img className="slot-preview" src={url} alt={`${label} preview`} />
          <span className="slot-file">
            <span className="slot-file-name">{file?.name}</span>
            <span className="slot-file-meta">
              {dims}
              {file && ` · ${formatBytes(file.size)}`}
            </span>
          </span>
          <button
            className="slot-clear"
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            aria-label={`Remove ${label} image`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
              <path
                d="m6 6 12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      ) : (
        <span className="slot-empty">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
            <path
              d="M12 16V4m0 0L7 9m5-5 5 5M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="slot-empty-text">
            Drop image, or <span className="link">browse</span>
          </span>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

type Pt = { x: number; y: number };
type AoiMode = "none" | "draw" | "upload";

function AoiPicker({
  beforeFile,
  onChange,
}: {
  beforeFile: File | null;
  onChange: (b: Blob | null) => void;
}) {
  const url = useObjectUrl(beforeFile);
  const [mode, setMode] = useState<AoiMode>("none");
  const [pts, setPts] = useState<Pt[]>([]);
  const [closed, setClosed] = useState(false);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const maskUrl = useObjectUrl(maskFile);
  const natural = useRef<{ w: number; h: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const [resizeTick, setResizeTick] = useState(0);

  // keep the overlay canvas sized to the image as it lays out / the window resizes
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || mode !== "draw") return;
    const ro = new ResizeObserver(() => setResizeTick((t) => t + 1));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [mode, url]);

  // natural dimensions of the before image (for full-res rasterisation)
  useEffect(() => {
    natural.current = null;
    if (!url) return;
    const im = new Image();
    im.onload = () => (natural.current = { w: im.naturalWidth, h: im.naturalHeight });
    im.src = url;
  }, [url]);

  // reset everything when the before image changes / is removed
  useEffect(() => {
    setMode("none");
    setPts([]);
    setClosed(false);
    setMaskFile(null);
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beforeFile]);

  const rasterise = useCallback(
    async (poly: Pt[]) => {
      const nat = natural.current;
      if (!nat || poly.length < 3) {
        onChange(null);
        return;
      }
      const c = document.createElement("canvas");
      c.width = nat.w;
      c.height = nat.h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#000";
      g.fillRect(0, 0, nat.w, nat.h);
      g.fillStyle = "#fff";
      g.beginPath();
      poly.forEach((p, i) => {
        const x = p.x * nat.w;
        const y = p.y * nat.h;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.closePath();
      g.fill();
      c.toBlob((b) => onChange(b), "image/png");
    },
    [onChange],
  );

  // draw the polygon overlay
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const r = wrap.getBoundingClientRect();
    cv.width = r.width;
    cv.height = r.height;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, cv.width, cv.height);
    if (mode !== "draw" || pts.length === 0) return;
    const P = pts.map((p) => ({ x: p.x * cv.width, y: p.y * cv.height }));
    g.lineWidth = 2;
    g.strokeStyle = "#12b8ac";
    g.fillStyle = "rgba(18,184,172,0.18)";
    g.beginPath();
    P.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    if (closed) {
      g.closePath();
      g.fill();
    }
    g.stroke();
    P.forEach((p, i) => {
      g.beginPath();
      g.arc(p.x, p.y, i === 0 ? 5.5 : 4, 0, Math.PI * 2);
      g.fillStyle = i === 0 ? "#0a6c64" : "#12b8ac";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "#fff";
      g.stroke();
    });
  }, [pts, closed, mode, url, resizeTick]);

  const addPoint = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (closed) return;
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (pts.length >= 3) {
      const d = Math.hypot(x - pts[0].x, y - pts[0].y);
      if (d < 0.03) {
        setClosed(true);
        rasterise(pts);
        return;
      }
    }
    setPts([...pts, { x, y }]);
  };

  const clearPoly = () => {
    setPts([]);
    setClosed(false);
    onChange(null);
  };

  const switchMode = (m: AoiMode) => {
    setMode(m);
    setPts([]);
    setClosed(false);
    setMaskFile(null);
    onChange(null);
  };

  if (!beforeFile) {
    return (
      <p className="aoi-empty">
        Add a <strong>before</strong> image first, then draw a region or upload a
        mask to limit detection to that area.
      </p>
    );
  }

  return (
    <div className="aoi">
      <div className="aoi-modes" role="tablist">
        {(
          [
            ["none", "Whole image"],
            ["draw", "Draw region"],
            ["upload", "Upload mask"],
          ] as [AoiMode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`aoi-mode ${mode === m ? "is-active" : ""}`}
            onClick={() => switchMode(m)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "draw" && (
        <>
          <p className="aoi-hint">
            Click on the image to place points. Click the first point (or “Close
            shape”) to finish.
          </p>
          <div className="aoi-canvas-wrap" ref={wrapRef}>
            <img src={url ?? ""} alt="before, for drawing the region" />
            <canvas
              ref={canvasRef}
              className="aoi-canvas"
              onClick={addPoint}
              style={{ cursor: closed ? "default" : "crosshair" }}
            />
          </div>
          <div className="aoi-actions">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setPts(pts.slice(0, -1))}
              disabled={closed || pts.length === 0}
            >
              Undo point
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                if (pts.length >= 3) {
                  setClosed(true);
                  rasterise(pts);
                }
              }}
              disabled={closed || pts.length < 3}
            >
              Close shape
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={clearPoly}
              disabled={pts.length === 0}
            >
              Clear
            </button>
            {closed && (
              <span className="aoi-ok">Region set ({pts.length} points)</span>
            )}
          </div>
        </>
      )}

      {mode === "upload" && (
        <>
          <p className="aoi-hint">
            A black &amp; white PNG the same size as your pair — white marks the
            area to analyse.
          </p>
          <div className="aoi-upload">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => maskInputRef.current?.click()}
            >
              {maskFile ? "Replace mask" : "Choose mask PNG"}
            </button>
            <input
              ref={maskInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setMaskFile(f);
                onChange(f);
              }}
            />
            {maskUrl && (
              <span className="aoi-mask-preview">
                <img src={maskUrl} alt="AOI mask preview" />
                {maskFile?.name}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ChangedGauge({
  percent,
  sub = "of image changed",
}: {
  percent: number;
  sub?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  return (
    <div className="gauge">
      <svg viewBox="0 0 80 80" width="88" height="88">
        <circle
          cx="40"
          cy="40"
          r={r}
          className="gauge-track"
          fill="none"
          strokeWidth="7"
        />
        <circle
          cx="40"
          cy="40"
          r={r}
          className="gauge-fill"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <span className="gauge-label">
        <span className="gauge-value">{percent.toFixed(2)}%</span>
        <span className="gauge-sub">{sub}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CompareSlider({
  before,
  after,
  afterLabel,
}: {
  before: string;
  after: string;
  afterLabel: string;
}) {
  const [pos, setPos] = useState(50);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = useCallback((clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      move(x);
    };
    const stop = () => (dragging.current = false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
    };
  }, [move]);

  return (
    <div
      className="compare"
      ref={wrapRef}
      style={{ ["--pos" as string]: `${pos}%` }}
      onMouseDown={(e) => {
        dragging.current = true;
        move(e.clientX);
      }}
      onTouchStart={(e) => {
        dragging.current = true;
        move(e.touches[0].clientX);
      }}
    >
      <img className="compare-base" src={after} alt="after with change overlay" />
      <span className="compare-tag compare-tag--r">{afterLabel}</span>
      <div className="compare-top">
        <img src={before} alt="before" />
      </div>
      <span className="compare-tag compare-tag--l">before</span>
      <div className="compare-handle">
        <span className="compare-grip">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path
              d="M9 6 4 12l5 6M15 6l5 6-5 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
      <input
        className="compare-range"
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Reveal before or after"
      />
    </div>
  );
}
