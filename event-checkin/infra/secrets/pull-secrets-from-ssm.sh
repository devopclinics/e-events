#!/usr/bin/env bash
#
# pull-secrets-from-ssm.sh — fetch env files from AWS SSM onto the server.
#
# Reverses push-secrets-to-ssm.sh: reads the SecureString params and writes
# backend/.env and .env next to docker-compose.prod.yaml, byte-exact.
#
# Runs ON THE SERVER (called by the bootstrap / user-data) using the instance's
# IAM role — it needs ssm:GetParameter + kms:Decrypt on <prefix>/*.
# No AWS keys on disk: the EC2 instance role supplies credentials.
#
# Usage:
#   AWS_REGION=us-east-1 ./pull-secrets-from-ssm.sh /opt/festio/event-checkin
#
# Overridable via env:
#   AWS_REGION   (default us-east-1)
#   SSM_PREFIX   (default /festio/prod)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${SSM_PREFIX:-/festio/prod}"
DEST="${1:-.}"   # the event-checkin dir where compose + env files live

command -v aws >/dev/null || { echo "ERROR: aws CLI not found" >&2; exit 1; }

get_file() {
  local name="$1" out="$2" blob
  blob="$(aws ssm get-parameter \
    --region "$REGION" \
    --name "$PREFIX/$name" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text)"
  mkdir -p "$(dirname "$out")"
  printf '%s' "$blob" | base64 -d | gunzip > "$out"
  chmod 600 "$out"
  echo "wrote $out"
}

get_file backend_env "$DEST/backend/.env"
get_file root_env    "$DEST/.env"
echo "secrets in place."
