FROM python:3.11-slim
WORKDIR /app
# Safe release defaults. Runtime enablement requires a separate approved change.
ENV MARKETING_OUTBOUND_ENABLED=false \
    MARKETING_SCHEDULER_ENABLED=false
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ app/
RUN mkdir -p /data
EXPOSE 8050
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8050"]
