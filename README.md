# ODDLY menu

iPad ordering menu for ODDLY. Customers pick items and choose cash or card; orders are saved to Postgres and shown in a PIN-protected daily report.

- `public/index.html` — the menu (tap a product to enlarge it)
- `server.js` — serves the menu and the `/api/orders` endpoints
- Env: `DATABASE_URL`, `REPORT_PIN`
