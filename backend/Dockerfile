# TheCraftSync change-detection API — CPU-only container
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# CPU wheels for torch first (keeps the image ~1.2 GB instead of ~6 GB CUDA),
# then the rest of the deps.
COPY requirements.txt .
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

# app code + vendored model weights (backend/ is the build context)
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
