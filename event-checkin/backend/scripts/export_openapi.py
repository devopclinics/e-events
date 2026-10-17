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

For local/CI generation without runtime credentials, use the explicit offline
mode (it does not enter the app lifespan or connect to the database):

    PYTHONPATH=. python scripts/export_openapi.py --offline
"""
import argparse
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline", action="store_true",
        help="Use explicit nonsecret database fixtures and skip local dotenv files; never connect to the database.",
    )
    args = parser.parse_args()
    if args.offline:
        # These fixtures exist only in this opt-in tooling process. Runtime
        # Settings still requires the deployment's real environment values.
        for key in tuple(os.environ):
            if key.lower() in {"database_url", "dashboard_ro_db_password"}:
                del os.environ[key]
        os.environ["DATABASE_URL"] = "postgresql+asyncpg://localhost/festio_tests"
        os.environ["DASHBOARD_RO_DB_PASSWORD"] = "offline-test-placeholder"
        original_cwd = Path.cwd()
        with TemporaryDirectory(prefix="festio-openapi-import-") as import_dir:
            try:
                os.chdir(import_dir)
                from app.main import app
            finally:
                os.chdir(original_cwd)
    else:
        # Existing Docker/live export preserves the deployed configuration.
        from app.main import app
    spec = app.openapi()
    # Sort keys so the diff in check-api-contract-drift.sh is stable across
    # runs and dict-ordering differences, not just across real spec changes.
    json.dump(spec, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
