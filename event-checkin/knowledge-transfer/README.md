# Festio Knowledge Transfer
Served at `https://festio.events/knowledge-transfer/` with HTTP Basic authentication.

Create or rotate credentials before deployment:
```bash
docker run --rm httpd:2.4-alpine htpasswd -Bbn USERNAME PASSWORD > proxy-htpasswd-knowledge-transfer
docker compose restart proxy
```
Share credentials through a password manager, never source control.
