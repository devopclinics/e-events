# Event Check-In QR System — Implementation Plan

## Overview
A full-stack event check-in application where guests receive personalised QR codes via email, officials scan them on the day, and each admission triggers an email + SMS confirmation. Includes a real-time admin dashboard.

---

## Tech Stack
| Layer | Choice |
|---|---|
| Backend API | Python FastAPI |
| Frontend | React (Vite) |
| Database | PostgreSQL |
| QR codes | `qrcode` + `Pillow` |
| Email | SMTP via `aiosmtplib` |
| SMS | Twilio |
| Real-time | Server-Sent Events (SSE) |
| Container | Docker |
| Deployment | Helm chart (follows existing golden-path pattern) |

---

## Directory Structure

```
event-checkin/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + CORS + routers
│   │   ├── database.py          # SQLAlchemy async engine + session
│   │   ├── models.py            # ORM models (Event, Guest)
│   │   ├── schemas.py           # Pydantic request/response schemas
│   │   ├── config.py            # Settings from env vars
│   │   └── routers/
│   │       ├── events.py        # Event CRUD + invite upload
│   │       ├── guests.py        # Guest list, QR generation, bulk email
│   │       ├── scanner.py       # QR scan → admit + notify
│   │       └── dashboard.py     # Stats + SSE stream
│   ├── services/
│   │   ├── qr_service.py        # Generate QR PNG per guest
│   │   ├── email_service.py     # Send invite / admit email
│   │   └── sms_service.py       # Twilio SMS
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── AdminPage.jsx    # Event config + CSV upload + send invites
│   │   │   ├── ScannerPage.jsx  # Camera QR scan for officials
│   │   │   └── DashboardPage.jsx# Live admitted-guest list
│   │   └── components/
│   │       ├── EventForm.jsx
│   │       ├── GuestTable.jsx
│   │       └── AdmissionResult.jsx
│   ├── package.json
│   └── Dockerfile
├── charts/
│   └── event-checkin/           # New Helm chart (golden-path pattern)
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│           ├── deployment-backend.yaml
│           ├── deployment-frontend.yaml
│           ├── service-backend.yaml
│           ├── service-frontend.yaml
│           ├── ingress.yaml
│           └── secret.yaml
├── env/
│   └── dev/workloads/event-checkin/
│       └── values.yaml          # Dev overrides (image tags, host, secrets ref)
├── clusters/local-k3s/apps/
│   └── event-checkin-dev.yaml   # ArgoCD Application
└── docker-compose.yaml          # Local development
```

---

## Database Schema

### `events`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR | e.g. "Smith-Jones Wedding" |
| couples_name | VARCHAR | e.g. "John & Jane" |
| event_date | TIMESTAMP | |
| description | TEXT | optional |
| checkin_base_url | VARCHAR | Base URL for QR links |
| created_at | TIMESTAMP | |

### `guests`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| event_id | UUID FK | → events.id |
| first_name | VARCHAR | |
| last_name | VARCHAR | |
| email | VARCHAR | |
| phone | VARCHAR | optional, E.164 format |
| qr_token | UUID UNIQUE | The secret embedded in QR |
| qr_generated_at | TIMESTAMP | null until generated |
| invite_sent_at | TIMESTAMP | null until emailed |
| admitted | BOOLEAN | default false |
| admitted_at | TIMESTAMP | null until scanned |
| admit_notified | BOOLEAN | default false |

---

## API Endpoints

### Event Management
| Method | Path | Description |
|---|---|---|
| POST | `/api/events` | Create event with name, couples_name, date |
| GET | `/api/events/{id}` | Get event details |
| PUT | `/api/events/{id}` | Update event config |
| GET | `/api/events` | List all events |

### Guest Management
| Method | Path | Description |
|---|---|---|
| POST | `/api/events/{id}/guests/upload` | Upload CSV (first, last, email, phone) |
| GET | `/api/events/{id}/guests` | List guests with admission status |
| POST | `/api/events/{id}/guests/generate-qr` | Generate QR codes for all guests |
| POST | `/api/events/{id}/guests/send-invites` | Email QR codes to all guests |

### Scanner
| Method | Path | Description |
|---|---|---|
| POST | `/api/scan/{qr_token}` | Admit guest — idempotent, returns admission state |

### Dashboard
| Method | Path | Description |
|---|---|---|
| GET | `/api/events/{id}/dashboard` | Stats (total, admitted, pending) + guest list |
| GET | `/api/events/{id}/stream` | SSE — pushes admission events in real time |

---

## Key User Flows

### 1. Admin Setup
1. Open AdminPage → fill in Event Name, Couples Name, Event Date
2. Upload CSV (`first_name, last_name, email, phone`)
3. Click "Generate QR Codes" → system creates a UUID `qr_token` per guest, renders QR PNG
4. Click "Send Invites" → each guest gets a personalised email with their QR code attached

### 2. Day-of Scanning
1. Official opens ScannerPage on any device with a camera
2. Camera scans guest's QR code → POST `/api/scan/{qr_token}`
3. **First scan**: marks `admitted=true`, sends email + Twilio SMS to guest → screen shows green "ADMITTED — Welcome, [Name]!"
4. **Repeat scan**: screen shows amber "ALREADY ADMITTED — [Name] checked in at [time]"
5. **Invalid token**: screen shows red "INVALID QR CODE"

### 3. Dashboard
- Real-time counter: "42 / 150 admitted"
- Live table: guest name, time admitted — newest first
- SSE pushes each new admission instantly without polling

---

## QR Code Content
Each QR encodes the URL:
```
https://{checkin_base_url}/scan/{qr_token}
```
When a phone camera scans it, it opens the scanner web page which submits the token to the API.

---

## Environment Variables (backend)
```
DATABASE_URL=postgresql+asyncpg://user:pass@host/db
SECRET_KEY=...
BASE_URL=https://checkin.dev.vsgs.local

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
EMAIL_FROM=noreply@event.com

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

---

## Helm Chart
Follows the existing `charts/tutor/` golden-path pattern:
- Two deployments: `backend` (port 8000) + `frontend` (nginx, port 80)
- Two ClusterIP services
- Single Traefik Ingress:
  - `/api/*` → backend service
  - `/*` → frontend service
- Kubernetes Secret for all env vars
- Labels comply with existing Kyverno policies (`app.kubernetes.io/name`, `team`, `managed-by`)
- Resource requests/limits set (required by `require-resources` policy)

---

## Implementation Steps

1. **Backend scaffold** — FastAPI app, SQLAlchemy async models, Alembic migrations, config
2. **QR service** — generate UUID token, render QR PNG to bytes/file
3. **Email service** — SMTP invite email with QR image attachment; admission confirmation email
4. **SMS service** — Twilio admission SMS
5. **Routers** — events, guests (CSV upload + bulk actions), scanner, dashboard + SSE
6. **Frontend scaffold** — Vite + React, React Router, Tailwind CSS
7. **AdminPage** — event form, CSV upload, guest table, action buttons
8. **ScannerPage** — `react-qr-reader` camera component, admission result display
9. **DashboardPage** — SSE hook, live stats bar, admitted-guest table
10. **Dockerfiles** — multi-stage builds for backend and frontend
11. **docker-compose** — local dev with PostgreSQL
12. **Helm chart** — `charts/event-checkin/` following golden-path
13. **ArgoCD Application** — `clusters/local-k3s/apps/event-checkin-dev.yaml`
14. **Commit & push** to `claude/event-checkin-qr-system-CFInr`
