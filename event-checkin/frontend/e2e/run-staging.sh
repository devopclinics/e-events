#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
frontend_dir="${repo_dir}/frontend"
base_url=${E2E_BASE_URL:-https://staging.festio.events}
node_dir=/home/dev/.vscode-remote-containers/bin/1b50d58d73426c9171299ec4037d01365d995b78

if [[ "$base_url" != "https://staging.festio.events" ]]; then
  echo "Refusing temporary-identity run outside staging: ${base_url}" >&2
  exit 2
fi

firebase_api_key=$(sed -n 's/^VITE_FIREBASE_API_KEY=//p' "${frontend_dir}/.env" | head -1)
if [[ -z "$firebase_api_key" ]]; then
  echo "VITE_FIREBASE_API_KEY is missing from frontend/.env" >&2
  exit 2
fi

cd "$repo_dir"
mapfile -t qa < <(docker compose exec -T -e QA_FIREBASE_API_KEY="$firebase_api_key" backend python - <<'PY'
import asyncio
import json
import os
import secrets
import string
import urllib.request

from firebase_admin import auth as firebase_auth
from sqlalchemy import select

from app.auth import _ensure_firebase
from app.database import AsyncSessionLocal
from app.models import Event, Membership, Organization, User

email = f"redesign-e2e-{secrets.token_hex(5)}@festio.events"
alphabet = string.ascii_letters + string.digits + "!@#%"
password = "".join(secrets.choice(alphabet) for _ in range(28))
_ensure_firebase()
record = firebase_auth.create_user(email=email, password=password, display_name="Redesign E2E")

payload = json.dumps({"email": email, "password": password, "returnSecureToken": True}).encode()
url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + os.environ["QA_FIREBASE_API_KEY"]
request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(request, timeout=30) as response:
    token = json.load(response)["idToken"]
request = urllib.request.Request(
    "http://localhost:8000/api/auth/me",
    headers={"Authorization": "Bearer " + token},
)
with urllib.request.urlopen(request, timeout=30):
    pass

second_email = f"redesign-e2e-2nd-{secrets.token_hex(5)}@festio.events"
second_password = "".join(secrets.choice(alphabet) for _ in range(28))
second_record = firebase_auth.create_user(email=second_email, password=second_password, display_name="Redesign E2E (staff)")

second_payload = json.dumps({"email": second_email, "password": second_password, "returnSecureToken": True}).encode()
second_request = urllib.request.Request(url, data=second_payload, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(second_request, timeout=30) as response:
    second_token = json.load(response)["idToken"]
second_me_request = urllib.request.Request(
    "http://localhost:8000/api/auth/me",
    headers={"Authorization": "Bearer " + second_token},
)
with urllib.request.urlopen(second_me_request, timeout=30):
    pass

async def grant():
    async with AsyncSessionLocal() as db:
        org = await db.scalar(select(Organization).where(Organization.slug == "internal-redesign-qa"))
        if not org or org.redesign_cohort == "legacy_only":
            raise RuntimeError("isolated QA organization is missing or not redesign-enabled")
        event = await db.scalar(select(Event).where(Event.org_id == org.id))
        user = await db.scalar(select(User).where(User.firebase_uid == record.uid))
        db.add(Membership(org_id=org.id, user_id=user.id, role="owner"))
        # Second identity joins the same org as a plain "staff" member (not
        # owner/admin) so the team permissions-matrix test can verify
        # EventUser-level can_manage_guests actually gates guest mutations,
        # independent of org role.
        second_user = await db.scalar(select(User).where(User.firebase_uid == second_record.uid))
        db.add(Membership(org_id=org.id, user_id=second_user.id, role="staff"))
        await db.commit()
        print(email)
        print(password)
        print(event.id)
        print(record.uid)
        print(user.id)
        print(org.id)
        print(org.redesign_cohort)
        print(second_email)
        print(second_password)
        print(second_record.uid)
        print(second_user.id)

asyncio.run(grant())
PY
)

if [[ ${#qa[@]} -ne 11 ]]; then
  echo "Temporary QA identity bootstrap failed" >&2
  exit 2
fi

cleanup() {
  docker compose exec -T -e QA_FIREBASE_UID="${qa[3]}" -e QA_USER_ID="${qa[4]}" \
    -e QA_SECOND_FIREBASE_UID="${qa[9]}" -e QA_SECOND_USER_ID="${qa[10]}" backend python - <<'PY' >/dev/null
import asyncio
import os

from firebase_admin import auth as firebase_auth
from sqlalchemy import delete, select

from app.auth import _ensure_firebase
from app.database import AsyncSessionLocal
from app.models import ApiKey, EventUser, Membership, Organization, User

_ensure_firebase()
for uid_env in ("QA_FIREBASE_UID", "QA_SECOND_FIREBASE_UID"):
    try:
        firebase_auth.delete_user(os.environ[uid_env])
    except Exception:
        pass

async def remove_user(user_id):
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if not user:
            return
        org_ids = list((await db.execute(
            select(Membership.org_id).where(Membership.user_id == user.id)
        )).scalars())
        await db.execute(delete(ApiKey).where(ApiKey.created_by_user_id == user.id))
        await db.execute(delete(EventUser).where(EventUser.user_id == user.id))
        await db.execute(delete(Membership).where(Membership.user_id == user.id))
        await db.delete(user)
        for org_id in org_ids:
            org = await db.get(Organization, org_id)
            if org and org.slug.startswith("org-"):
                await db.delete(org)
        await db.commit()

async def remove():
    await remove_user(os.environ["QA_USER_ID"])
    await remove_user(os.environ["QA_SECOND_USER_ID"])

asyncio.run(remove())
PY
}
trap cleanup EXIT

export E2E_BASE_URL="$base_url"
export E2E_EMAIL="${qa[0]}"
export E2E_PASSWORD="${qa[1]}"
export E2E_EVENT_ID="${qa[2]}"
export E2E_REDESIGN_ORG_ID="${qa[5]}"
export E2E_REDESIGN_ORG_COHORT="${qa[6]}"
export E2E_SECOND_EMAIL="${qa[7]}"
export E2E_SECOND_PASSWORD="${qa[8]}"
export PATH="${node_dir}:${PATH}"

cd "$frontend_dir"
exec_status=0
./node_modules/.bin/playwright test "$@" || exec_status=$?
exit "$exec_status"
