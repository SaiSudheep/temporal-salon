# Juniper Salon

A Temporal-powered waitlist prototype. Texts are simulated; staff keep appointments updated in Square.

## Run

Requirements: **Node.js 20+** and **Docker Desktop running**. From the repository folder:

```sh
npm start
```

This installs dependencies on the first run and starts Temporal, the API, and the worker. Keep the terminal open. In Windows PowerShell, use `npm.cmd start` if `npm` is blocked by execution policy.

- **App:** http://localhost:3000
- **Temporal Web UI:** http://localhost:8233

To try the flow, add fictional demo clients and create a same-day, 45-minute Haircut opening with Jessica. Choose a future time that fits entirely within today (Pacific time). Enable **20-second offers** to watch a timeout automatically move the offer to the next client, then open the client link to accept.

## Test

Keep the app running. In a second terminal, run:

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:ui
```

The browser installation is needed only once. On Windows PowerShell, use `npm.cmd` and `npx.cmd` if necessary.

The tests cover matching, automatic timeouts, stale and competing acceptances, cancellation, worker restart recovery, and desktop/mobile browser flows. Browser tests use a separate API on port 3100.

Stop the app with **Ctrl+C**. To stop the Docker service afterward:

```sh
npm run stop
```

## Submission files

- [Temporal Web UI screenshot](evidence/temporal-history.png)
- [Five-slide presentation for Lena](presentation/Juniper-Salon-Lena-Review.pdf)
