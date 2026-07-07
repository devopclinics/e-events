#!/usr/bin/env bash
#
# push-secrets-to-ssm.sh — upload local env files to AWS SSM Parameter Store.
#
# Each env file is gzip+base64'd and stored as ONE SecureString parameter, so:
#   - it round-trips byte-exact (handles the big FIREBASE_CREDENTIALS JSON,
#     quotes, '=' in values, etc.),
#   - it stays under SSM's 4 KB standard-tier limit (free), and
#   - rotating a secret is just: edit the file, re-run this script.
#
# Run this LOCALLY (from a trusted machine that has the real .env files) with AWS
# credentials allowed to ssm:PutParameter + kms:Encrypt on the target key.
#
# The matching pull-secrets-from-ssm.sh runs on the server at bootstrap.
#
# Usage:
#   AWS_REGION=us-east-1 ./infra/secrets/push-secrets-to-ssm.sh
#
# Overridable via env:
#   AWS_REGION   (default us-east-1)
#   SSM_PREFIX   (default /festio/prod)      -> params: <prefix>/backend_env, <prefix>/root_env
#   SSM_KMS_KEY  (default alias/aws/ssm)     -> the free AWS-managed SSM key; set a CMK for tighter control
#
# NOTE: frontend/.env (VITE_FIREBASE_*) is NOT stored here — it's public build-time
# config baked into the frontend image, so it belongs in GitHub Actions *Variables*,
# not in server-side secret storage.

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${SSM_PREFIX:-/festio/prod}"
KMS_KEY="${SSM_KMS_KEY:-alias/aws/ssm}"

# Resolve the event-checkin dir (two levels up from this script).
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

command -v aws >/dev/null || { echo "ERROR: aws CLI not found" >&2; exit 1; }

put_file() {
  local name="$1" file="$2"
  if [[ ! -f "$file" ]]; then
    echo "skip: $file not found" >&2
    return 0
  fi
  local blob size
  blob="$(gzip -c "$file" | base64 -w0)"
  size=${#blob}
  if (( size > 4096 )); then
    echo "ERROR: $name is ${size}B compressed+b64 (>4096 standard-tier limit)." >&2
    echo "       Use '--tier Advanced' (small monthly cost) or split the file." >&2
    exit 1
  fi
  aws ssm put-parameter \
    --region "$REGION" \
    --name "$PREFIX/$name" \
    --type SecureString \
    --key-id "$KMS_KEY" \
    --value "$blob" \
    --overwrite >/dev/null
  echo "pushed $PREFIX/$name  (${size}B, encrypted with $KMS_KEY)"
}

echo "Region: $REGION   Prefix: $PREFIX"
put_file backend_env "$APP_DIR/backend/.env"
put_file root_env    "$APP_DIR/.env"
echo "done."
