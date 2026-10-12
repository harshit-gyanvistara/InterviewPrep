FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml ./
COPY live_agent ./live_agent
RUN pip install --no-cache-dir .
# Cloud Run sets $PORT. Secrets (GEMINI_API_KEY, LIVE_AGENT_TOKEN) come from the platform, not a file.
CMD ["sh", "-c", "uvicorn live_agent.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
