# Festio Knowledge Transfer
Served at `https://festio.events/knowledge-transfer/` with HTTP Basic authentication.

This directory ships as a plain static site inside the frontend build (it's
under `frontend/public/`, so Vite copies it to `dist/` verbatim like any other
public asset) — no separate deploy step for the content itself. Only the
basic-auth layer is environment-specific:

- **Staging** (docker-compose): `proxy-htpasswd-knowledge-transfer` bind-mounted
  into the `proxy` container. Create/rotate:
  ```bash
  docker run --rm httpd:2.4-alpine htpasswd -Bbn USERNAME PASSWORD > proxy-htpasswd-knowledge-transfer
  docker compose restart proxy
  ```
- **Prod** (k8s): the htpasswd file content lives as an SSM parameter
  (`KNOWLEDGE_TRANSFER_HTPASSWD` in festio-infra/secrets), synced via
  ExternalSecrets into the `festio-secrets` Secret and mounted as a file into
  the `proxy` Deployment. Rotate via `festio-infra`'s `make push-secrets`.

Never commit plaintext passwords or the real htpasswd file — both are
gitignored.
