"""Print the live FastAPI OpenAPI document as JSON on stdout.

This is the source of truth the frontend's generated types (see
frontend/scripts/generate-api-types.mjs) are built from, and what
frontend/scripts/check-api-contract-drift.sh diffs against to catch
undocumented API changes before they silently break the redesign's adapters.

The backend runs in a container that doesn't have this scripts/ directory
copied in (only app/ and services/), and its filesystem is isolated from the
host anyway, so this deliberately writes to stdout rather than a path — the
caller redirects it to docs/api-contract/openapi.json on the host. Run via:

    docker exec -i event-checkin-backend-1 python - < backend/scripts/export_openapi.py \\
      > docs/api-contract/openapi.json
"""
import json
import sys

from app.main import app


def main() -> None:
    spec = app.openapi()
    # Sort keys so the diff in check-api-contract-drift.sh is stable across
    # runs and dict-ordering differences, not just across real spec changes.
    json.dump(spec, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
