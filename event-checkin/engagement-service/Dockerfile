FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Chromium for the PPTX exporter's headless screenshots (app/pptx_export.py).
# --with-deps pulls the OS libraries Chromium needs on this Debian base.
RUN playwright install --with-deps chromium
COPY app/ app/
COPY migrations/ migrations/
COPY scripts/ scripts/
COPY fixtures/ fixtures/

EXPOSE 8060
CMD ["sh", "-c", "python -m app.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port 8060 --no-access-log"]
