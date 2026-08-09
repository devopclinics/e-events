# Festio Marketing service

An isolated internal service for customer acquisition and lifecycle operations.
It owns its SQLite database and communicates with Festio only through scoped
JWTs and an authenticated lifecycle-ingest contract.

Modules:

- lead pipeline, scoring, ownership, consent, notes, and attribution
- segments and lifecycle follow-up sequences
- campaigns and content calendar
- referrals, internal tasks, and experiments
- staff grants controlled only by platform super-admins
- funnel dashboard and consent-safe follow-up automation

The backend sends registration and event-creation lifecycle signals on a
best-effort basis. Marketing downtime never blocks authentication or event
operations. The service accepts no main-database connection.
