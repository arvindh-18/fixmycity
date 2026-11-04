FROM python:3.12-slim

# Prevent Python from writing bytecode and buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies first for efficient layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create a non-root system user and prepare local media/outbox fallback directories
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser \
    && mkdir -p /app/media /app/outbox \
    && chown -R appuser:appuser /app

# Copy application code
COPY . .
RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# Run migrations at container startup, then start a single-worker uvicorn server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1"]

