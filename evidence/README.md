# Prototype evidence

All pictured clients and phone numbers are fictional. SMS is simulated and Square is updated manually.

## Interface

- [Staff desktop](staff-desktop.png): current offer, real remaining deadline, eligible clients, simulated notification, and history.
- [Client mobile](client-mobile.png): phone-sized accept/decline experience.
- [Staff mobile](staff-mobile.png): responsive staff view after acceptance and the Square update.

## Real Temporal execution

[Temporal event history](temporal-history.png) shows workflow ID, Running status, Update events, persisted timers, and cancellation outcomes. [workflow.json](workflow.json) records the exact workflow and run IDs and its local Web UI URL.

The `salonWorkflow` coordinator intentionally remains Running so the salon can keep adding clients and openings. Individual openings inside it reach filled, unfilled, or cancelled states. The browser tests exercised an accepted appointment, a timed-out offer, and a cancelled opening in this captured workflow.

## Verification performed

- TypeScript: `npm run typecheck` passed.
- Business rules: eight tests passed.
- Real Temporal integration: one test passed. It stops a worker before a deadline, waits through the deadline, restarts the worker, verifies progression, races stale/current/repeated acceptances, checks cross-opening client reservations, and verifies state after another restart.
- Browser: two Playwright scenarios passed on desktop and 390px mobile viewports. They cover decline-to-next progression, acceptance, Square completion, timeout, cancellation, stale acceptance rejection, and horizontal overflow. The main flow also checks for uncaught page errors.

To regenerate the interface screenshots, run `npm run test:ui` with the local Temporal service and app worker running. Then run `node scripts/capture-evidence.mjs` to capture the latest qualifying browser-test workflow in the Temporal Web UI.

The 50% refill target comes from Lena's customer interview. These controlled tests establish prototype behavior, not a measured real-world refill rate.
