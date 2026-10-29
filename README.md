# HR Business Partner Tasks

Personal task list for HR Business Partners: AI categories, achievements, special days and a morning push reminder.

Runs on Render as a Node web service (`node server.js`). Data lives in the `hrbp` schema of the Eventana Postgres database.

Environment variables:
- `DATABASE_URL` – Postgres connection string
- `ANTHROPIC_API_KEY` – turns on AI categories, summaries and the daily note
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` – turn on phone notifications
- `DIGEST_TIME` – morning reminder time in Dubai (default 07:44)
