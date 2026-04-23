# --- build stage -------------------------------------------------------------
FROM python:3.12-slim-bookworm AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && \
    pip install --target=/install -r requirements.txt

# --- runtime stage -----------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PATH="/install/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app --create-home app

WORKDIR /app

COPY --from=build --chown=app:app /install /install
COPY --chown=app:app app ./app
COPY --chown=app:app pytest.ini ./

USER app

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf http://127.0.0.1:3002/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]
