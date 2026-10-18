# Eventana E2E (Playwright)

End-to-end browser tests for the customer booking website. Kept **outside** the
npm workspaces so it installs and runs on its own in CI.

## Safety
- **Read-only** and **stops before payment** — no real booking or customer
  record is ever created. Synthetic test data only (`QA Test …`).
- There is no staging environment, so tests default to the live site. Point them
  elsewhere with `BASE_URL` (a PR preview, or a local `vite preview`).

## Run (CI, or any machine with Node 20)
```bash
cd tests/e2e
npm install
npx playwright install --with-deps chromium
BASE_URL=https://eventanauae.com npx playwright test
npx playwright show-report   # open the HTML report
```
The developer machine has no Node, so these run in GitHub Actions
(`.github/workflows/qa.yml`) — that is the verification surface.

## What's covered
`tests/customer-booking.smoke.spec.ts`:
- Home loads + the WELCOME10 welcome popup shows (fix #1).
- Full package booking journey, asserting the four 2026-10-18 fixes:
  adding a catalogue item keeps the package (#4), returns to the same step (#3)
  with contact details intact (#3), and the available-code hint shows (#2).

Selectors are text/role based and written against the live SPA as of
2026-10-18; expect to tune them on the first CI run.

## Next
- Ops (dashboard) auth + permission-boundary suite.
- Cross-application suite (booking on site → appears in Ops).
