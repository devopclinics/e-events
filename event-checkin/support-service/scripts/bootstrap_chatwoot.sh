#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# bootstrap_chatwoot.sh — provision Chatwoot's account/inbox/agent-bot/webhook
# for a given environment's Chatwoot pod, then push the resulting
# CHATWOOT_ACCOUNT_ID / CHATWOOT_INBOX_ID / CHATWOOT_API_ACCESS_TOKEN /
# CHATWOOT_HMAC_SECRET / CHATWOOT_WEBHOOK_TOKEN straight to SSM as individual
# SecureStrings, the same convention festio-infra/scripts/push-secrets-eso.sh
# uses (so ESO picks them up into the festio-secrets Secret automatically).
#
# Replaces the manual "click through the setup wizard" bootstrap documented
# in README.md with a single idempotent run — safe to re-run: every step in
# chatwoot_bootstrap.rb finds-or-creates instead of duplicating.
#
# Requires: kubectl context pointed at the target cluster, aws CLI creds with
# ssm:PutParameter + kms:Encrypt.
#
# Usage:
#   BOOTSTRAP_ADMIN_EMAIL=ops@festio.events \
#   BOOTSTRAP_WEBHOOK_BASE_URL=https://festio.events \
#     ./bootstrap_chatwoot.sh
#
# Overridable via env:
#   NAMESPACE            (default festio)
#   DEPLOYMENT           (default chatwoot)
#   AWS_REGION           (default us-east-1)
#   SSM_PATH             (default /festio/prod/backend/)
#   SSM_KMS_KEY          (default alias/aws/ssm)
#   PUSH_TO_SSM          (default true; set false to only print the JSON)
#   BOOTSTRAP_ACCOUNT_NAME, BOOTSTRAP_INBOX_NAME, BOOTSTRAP_ADMIN_NAME,
#   BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_WEBHOOK_TOKEN, BOOTSTRAP_WIDGET_WEBSITE_URL
#     — see chatwoot_bootstrap.rb for defaults.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NAMESPACE="${NAMESPACE:-festio}"
DEPLOYMENT="${DEPLOYMENT:-chatwoot}"
REGION="${AWS_REGION:-us-east-1}"
SSM_PATH="${SSM_PATH:-/festio/prod/backend/}"
SSM_PATH="${SSM_PATH%/}/"
KMS_KEY="${SSM_KMS_KEY:-alias/aws/ssm}"
PUSH_TO_SSM="${PUSH_TO_SSM:-true}"

: "${BOOTSTRAP_ADMIN_EMAIL:?set BOOTSTRAP_ADMIN_EMAIL=<agent login email>}"
: "${BOOTSTRAP_WEBHOOK_BASE_URL:?set BOOTSTRAP_WEBHOOK_BASE_URL=<e.g. https://festio.events>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUBY_SCRIPT="$SCRIPT_DIR/chatwoot_bootstrap.rb"
[[ -f "$RUBY_SCRIPT" ]] || { echo "ERROR: $RUBY_SCRIPT not found" >&2; exit 1; }

command -v kubectl >/dev/null || { echo "ERROR: kubectl not found" >&2; exit 1; }
if [[ "$PUSH_TO_SSM" == "true" ]]; then
  command -v aws >/dev/null || { echo "ERROR: aws CLI not found (or set PUSH_TO_SSM=false)" >&2; exit 1; }
fi

echo "→ Running bootstrap inside deploy/$DEPLOYMENT (namespace $NAMESPACE)…"

# Only forward optional vars the caller actually set — chatwoot_bootstrap.rb
# uses ENV.fetch(key, default), which falls back to the default ONLY when the
# key is absent. Passing it through `env KEY=""` when unset sets it to an
# empty string instead, which ENV.fetch treats as "present" and returns
# verbatim — e.g. Account.find_or_create_by!(name: "") then fails validation
# instead of falling back to "Festio Support".
FORWARD_ENV=(BOOTSTRAP_ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" BOOTSTRAP_WEBHOOK_BASE_URL="$BOOTSTRAP_WEBHOOK_BASE_URL")
for var in BOOTSTRAP_ACCOUNT_NAME BOOTSTRAP_INBOX_NAME BOOTSTRAP_ADMIN_NAME \
           BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_WEBHOOK_TOKEN BOOTSTRAP_WIDGET_WEBSITE_URL; do
  if [[ -n "${!var:-}" ]]; then
    FORWARD_ENV+=("$var=${!var}")
  fi
done

RAW_OUTPUT="$(kubectl -n "$NAMESPACE" exec -i "deploy/$DEPLOYMENT" -- \
  env "${FORWARD_ENV[@]}" bundle exec rails runner - < "$RUBY_SCRIPT")"

echo "$RAW_OUTPUT"

JSON_LINE="$(echo "$RAW_OUTPUT" | grep '^BOOTSTRAP_JSON:' | sed 's/^BOOTSTRAP_JSON://')"
if [[ -z "$JSON_LINE" ]]; then
  echo "ERROR: bootstrap script did not print a BOOTSTRAP_JSON line — see output above for the Ruby error." >&2
  exit 1
fi

echo
echo "→ Parsed result:"
echo "$JSON_LINE" | python3 -m json.tool

if [[ "$PUSH_TO_SSM" != "true" ]]; then
  echo
  echo "PUSH_TO_SSM=false — not pushing to SSM. Copy the five CHATWOOT_* values above by hand."
  exit 0
fi

echo
echo "→ Pushing CHATWOOT_* keys to SSM under ${SSM_PATH} (region $REGION)…"
for key in CHATWOOT_ACCOUNT_ID CHATWOOT_INBOX_ID CHATWOOT_API_ACCESS_TOKEN CHATWOOT_HMAC_SECRET CHATWOOT_WEBHOOK_TOKEN; do
  val="$(echo "$JSON_LINE" | python3 -c "import json,sys; print(json.load(sys.stdin)['$key'])")"
  aws ssm put-parameter \
    --region "$REGION" \
    --name "${SSM_PATH}${key}" \
    --type SecureString \
    --key-id "$KMS_KEY" \
    --value "$val" \
    --overwrite >/dev/null
  echo "  put ${SSM_PATH}${key}"
done

echo
echo "✓ Pushed. ESO syncs on its own interval — force it now with:"
echo "    kubectl -n $NAMESPACE annotate externalsecret festio-secrets force-sync=\$(date +%s) --overwrite"
echo "  then restart the consumers so they pick up the refreshed Secret:"
echo "    kubectl -n $NAMESPACE rollout restart deploy/support-service deploy/support-worker"
echo
echo "  Verify it actually took (checks env vars + calls Chatwoot's own API + confirms the webhook is registered):"
echo "    kubectl -n $NAMESPACE exec deploy/support-service -- python scripts/verify_chatwoot_bootstrap.py"
echo
admin_email="$(echo "$JSON_LINE" | python3 -c "import json,sys; print(json.load(sys.stdin)['admin_email'])")"
admin_password="$(echo "$JSON_LINE" | python3 -c "import json,sys; print(json.load(sys.stdin)['admin_password'])")"
echo "  Agent login for the Chatwoot UI: $admin_email / $admin_password"
echo "  (save that password now — this script only prints a freshly-generated one once)"
