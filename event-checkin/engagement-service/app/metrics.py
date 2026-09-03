from prometheus_client import Counter, Gauge, Histogram

HTTP_REQUESTS = Counter("engagement_http_requests_total", "HTTP requests", ["method", "path", "status"])
HTTP_LATENCY = Histogram("engagement_http_request_seconds", "HTTP request latency", ["method", "path"])
RESPONSES = Counter("engagement_responses_total", "Durable participant responses")
REALTIME_CONNECTIONS = Gauge("engagement_realtime_connections", "Active SSE connections")
REALTIME_PUBLISH_FAILURES = Counter("engagement_realtime_publish_failures_total", "Redis publish failures")
AI_JOBS = Counter("engagement_ai_jobs_total", "AI analysis jobs", ["outcome"])
DEPENDENCY_LATENCY = Histogram("engagement_dependency_seconds", "Dependency check latency", ["dependency"])
DEPENDENCY_HEALTH = Gauge("engagement_dependency_health", "Dependency health (1=healthy, 0=degraded)", ["dependency"])
WORKFLOW_TRANSITIONS = Counter("engagement_workflow_transitions_total", "Authoritative workflow run transitions", ["action"])
ACTIVE_WORKFLOW_RUNS = Gauge("engagement_active_workflow_runs", "Workflow runs currently live or paused")
