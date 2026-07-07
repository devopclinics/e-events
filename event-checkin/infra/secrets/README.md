# Secrets → AWS SSM Parameter Store

Runtime secrets never live in git or in the Docker images. They live as
**SecureString** parameters in SSM Parameter Store (KMS-encrypted, free standard
tier) and are pulled onto the server at boot by the instance's IAM role.

## What's stored

| SSM parameter | Source file | Contents |
|---|---|---|
| `/festio/prod/backend_env` | `backend/.env` | DB URL, Firebase creds, Stripe/Paystack, Bird/Twilio/Meta WhatsApp, SMTP, superadmins… |
| `/festio/prod/root_env` | `.env` | `DOCKER_USERNAME/PASSWORD`, `DB_PASSWORD`, backup + prune settings |

Each file is `gzip | base64`'d into one SecureString — byte-exact round-trip,
under the 4 KB standard-tier limit (backend ≈ 3.7 KB, root ≈ 1 KB).

**Not stored here:** `frontend/.env` (`VITE_FIREBASE_*`) is public build-time
config baked into the frontend bundle → put those in **GitHub Actions → Variables**
(the release workflow reads them). And the Cloudflare Tunnel token gets its own
param (`/festio/prod/cloudflared_token`) once the tunnel exists.

## Push (one-time + on every secret rotation)

Run locally, from a trusted machine that has the real `.env` files:

```bash
cd event-checkin
AWS_REGION=us-east-1 ./infra/secrets/push-secrets-to-ssm.sh
```

Needs AWS creds allowed to `ssm:PutParameter` + `kms:Encrypt` (a minimal IAM
policy on your admin/CI user):

```json
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["ssm:PutParameter"], "Resource": "arn:aws:ssm:us-east-1:*:parameter/festio/prod/*" },
  { "Effect": "Allow", "Action": ["kms:Encrypt","kms:GenerateDataKey"], "Resource": "*" }
] }
```

To rotate a secret: edit `backend/.env` (or `.env`) and re-run — `--overwrite` is on.

## Pull (on the server, automatic)

The bootstrap / user-data calls this using the **instance role** (no keys on disk):

```bash
AWS_REGION=us-east-1 ./infra/secrets/pull-secrets-from-ssm.sh /opt/festio/event-checkin
```

The instance role needs (Terraform in `../` creates this):

```json
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["ssm:GetParameter","ssm:GetParametersByPath"], "Resource": "arn:aws:ssm:us-east-1:*:parameter/festio/prod/*" },
  { "Effect": "Allow", "Action": ["kms:Decrypt"], "Resource": "*" }
] }
```

## Notes

- Default KMS key is the free `alias/aws/ssm`. For tighter control set
  `SSM_KMS_KEY=<cmk-arn>` on push and grant the instance role `kms:Decrypt` on it.
- Staging later? Reuse everything with `SSM_PREFIX=/festio/staging`.
