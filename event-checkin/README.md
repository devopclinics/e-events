# EventQR — Event Check-In System

A full-stack event check-in platform with QR-code invites, real-time admission dashboard, and role-based access for admins and scanning officials.

---

## How it works

```
Admin                 Guest                        Official
  │                     │                              │
  │  1. Create event     │                              │
  │  2. Upload CSV       │                              │
  │  3. Generate QRs     │                              │
  │  4. Send invites ────►  Receives email with QR      │
  │                     │                              │
  │                     │  (Day of event)              │
  │                     │  Shows QR at entrance ───────►  Scans with Scanner page
  │                     │                              │  POST /api/scan/{token}
  │                     │◄──────────────────────────── │  Guest admitted ✓
  │                     │  SMS + email confirmation    │
  │◄────────────────────────────────────────────────── │
  │  Live dashboard                                    │
  │  updates in real time                              │
```

---

## Quick Start (Docker Compose)

### 1. Clone and configure

```bash
git clone https://github.com/devopclinics/platform-tutor.git
cd platform-tutor/event-checkin

# Copy and edit environment variables
cp backend/.env.example backend/.env
nano backend/.env
```

### 2. Set required values in `backend/.env`

```env
# Minimum required — everything else is optional
DATABASE_URL=postgresql+asyncpg://checkin:checkin@db:5432/checkin
SECRET_KEY=<generate: openssl rand -hex 32>
JWT_SECRET=<generate: openssl rand -hex 32>
FRONTEND_URL=https://events.vsgs.io
```

### 3. Start everything

```bash
docker compose up -d --build
```

That's it. The app is live at **http://events.vsgs.io** (once DNS is configured).

---

## Cloudflare + Domain Setup (events.vsgs.io)

### DNS record

| Type | Name   | Content       | Proxy |
|------|--------|---------------|-------|
| A    | events | `<server IP>` | ✅ Proxied |

### SSL/TLS settings

In Cloudflare dashboard → **SSL/TLS** → set mode to **Full** (not Full Strict, since the server uses plain HTTP internally).

### Firewall

The server only needs port **80** open. Cloudflare handles HTTPS termination.

The `proxy.conf` already includes all Cloudflare IP ranges to restore real visitor IPs (`CF-Connecting-IP` header).

---

## Google OAuth Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or select existing)
3. **APIs & Services → OAuth consent screen**
   - Choose **External**
   - Fill in App name: `EventQR`, your email, and `vsgs.io` as the authorized domain
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://events.vsgs.io/api/auth/google/callback`
5. Copy the **Client ID** and **Client Secret** into `backend/.env`:

```env
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=https://events.vsgs.io/api/auth/google/callback
```

6. Restart: `docker compose restart backend`

> If you skip Google OAuth, manual email/password sign-in still works — just leave the Google keys blank.

---

## Email (SMTP) Setup

For invite emails and admission confirmations. Gmail example:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx   # Gmail App Password (not your login password)
SMTP_TLS=true
EMAIL_FROM=you@gmail.com
```

To generate a Gmail App Password: Google Account → Security → 2-Step Verification → App passwords.

> Leave `SMTP_HOST` blank to disable email — the system still works, guests just won't receive invite emails.

---

## SMS (Twilio) Setup

For admission SMS notifications.

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

> Leave `TWILIO_ACCOUNT_SID` blank to disable SMS.

---

## User Roles

| Role | Access |
|------|--------|
| **Admin** | Create events, manage all events globally, assign team members, view dashboard |
| **Official** | Scanner only — for events they are explicitly assigned to |

Officials see **only** the events they have been assigned to. Admins see all events.

### Creating the first admin

1. Visit `https://events.vsgs.io/register`
2. Select **Admin** role
3. Fill in name, email, password — or use Google sign-in

---

## Event Lifecycle

Every event moves through three states:

```
draft ──▶ active ──▶ ended
              ↑          │
              └──────────┘  (reopen if needed)
```

| State | Scanning | Guest management | Dashboard |
|-------|----------|-----------------|-----------|
| **Draft** | ❌ Blocked | ✅ Upload, QR, invites | ✅ Read |
| **Active** | ✅ Live | ✅ Continue setup | ✅ Live |
| **Ended** | ❌ Blocked | ✅ Read-only | ✅ Final record |

Control this with the **Start Event / End Event / Reopen** buttons in the Admin panel.

---

## Team Assignment (per event)

Each event has its own team. From the Admin panel → select an event → **Event Team** section:

- **Assign** any registered user (admin or official) to the event
- **Remove** them when the event is over
- Assigned **admins** can manage guests, invites, and view the dashboard for that event
- Assigned **officials** can scan QR codes for that event
- Officials assigned to Event A **cannot** scan Event B's guests — the backend enforces this

The event creator is automatically added to the team.

---

## CSV Upload Format

Upload a `.csv` file with these columns (header row required):

```csv
first_name,last_name,email,phone
John,Smith,john@email.com,+447911123456
Jane,Doe,jane@email.com,
```

- `phone` is optional — leave blank if no SMS is needed
- Phone numbers must be in E.164 format (`+country_code...`)
- Duplicate emails are skipped automatically

---

## Admin Workflow (Day Before Event)

1. **Create event** — name, couple's name, date, and your app URL (`https://events.vsgs.io`)
2. **Upload CSV** — your guest list
3. **Generate QR Codes** — marks all guests as QR-ready
4. **Send Invites** — emails each guest their personal QR code

## Day-of Workflow

1. **Officials** open `https://events.vsgs.io/scanner` on their phones/tablets
2. Each official signs in with their account (admin or official role)
3. Point camera at guest's QR code — the app admits instantly
4. **Green screen** = admitted ✓ (guest also receives SMS + email)
5. **Amber screen** = already admitted (duplicate scan, show time of first scan)
6. **Red screen** = invalid QR

## Guest Experience

Guests receive an email with their QR code image attached.

On the day, they **show the QR code to the official** (either from email or by opening the link in the QR which shows their digital ticket).

The digital ticket at `https://events.vsgs.io/scan/{token}` shows:
- Event name and couple's name
- Guest's full name
- Their QR code (for officials to scan from the screen)
- Status badge: **Valid Ticket** → **Admitted** (after check-in)

---

## Architecture

```
Cloudflare (SSL)
      │
      ▼ port 80
  nginx proxy
  ┌──────────────────────────────┐
  │  /api/*  → backend:8000      │
  │  /*      → frontend:80       │
  └──────────────────────────────┘
      │                │
      ▼                ▼
  FastAPI          React (Vite)
  + PostgreSQL     served by nginx
```

### Key API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | — | Create account |
| `POST` | `/api/auth/login` | — | Get JWT token |
| `GET` | `/api/auth/google` | — | Google OAuth redirect |
| `GET` | `/api/scan/{token}/ticket` | — | Guest views their ticket (public) |
| `GET` | `/api/scan/{token}/qr.png` | — | QR image for ticket page (public) |
| `POST` | `/api/scan/{token}` | Official+ | Admit guest |
| `POST` | `/api/events` | Admin | Create event |
| `POST` | `/api/events/{id}/guests/upload` | Admin | Upload CSV |
| `POST` | `/api/events/{id}/guests/generate-qr` | Admin | Mark QRs ready |
| `POST` | `/api/events/{id}/guests/send-invites` | Admin | Email invites |
| `GET` | `/api/events/{id}/dashboard` | Admin | Stats |
| `GET` | `/api/events/{id}/stream` | Admin | SSE live updates |

---

## Kubernetes Deployment (Helm + ArgoCD)

The `charts/event-checkin/` Helm chart follows the platform golden-path pattern.

```bash
# Preview rendered templates
helm template event-checkin charts/event-checkin/ \
  -f env/dev/workloads/event-checkin/values.yaml

# Manual deploy (ArgoCD does this automatically via GitOps)
helm upgrade --install event-checkin charts/event-checkin/ \
  -f env/dev/workloads/event-checkin/values.yaml \
  --namespace dev-platform-event-checkin \
  --create-namespace
```

The ArgoCD Application at `clusters/local-k3s/apps/event-checkin-dev.yaml` syncs automatically on every push to `main`.

---

## Updating

```bash
# Pull latest, rebuild
docker compose pull
docker compose up -d --build

# Database schema is auto-updated on backend startup (SQLAlchemy create_all)
```
