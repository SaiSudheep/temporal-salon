import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client, Connection } from "@temporalio/client";
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
} from "@temporalio/worker";
import { salonWorkflow, changeSalon, getSalon } from "../src/workflows";
import type { Opening, SalonState, WaitlistEntry } from "../src/types";

// Uses the starter's Docker Temporal server. Unique queue and ID isolate tests from the app.
test(
  "real Temporal timers, concurrent decisions, and restart recovery",
  { timeout: 120_000 },
  async () => {
    const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
    const connection = await Connection.connect({ address });
    const native = await NativeConnection.connect({ address });
    const client = new Client({ connection });
    const taskQueue = `juniper-test-${randomUUID()}`;
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: require.resolve("../src/workflows"),
    });
    let worker = await Worker.create({
      connection: native,
      taskQueue,
      workflowBundle,
    });
    let running = worker.run();
    let handle:
      | ReturnType<typeof client.workflow.getHandle<typeof salonWorkflow>>
      | undefined;
    try {
      const now = Date.now();
      const requests: WaitlistEntry[] = ["Maya", "Olivia", "Nora"].map(
        (name, i) => ({
          id: name,
          clientId: name,
          name,
          mobile: `202555011${i}`,
          service: "Haircut",
          stylist: "Any stylist",
          durationMinutes: 45,
          availableFrom: now - 1000,
          availableUntil: now + 10_000_000,
          joinedAt: now + i,
          status: "waiting",
          existingAppointment: "",
        }),
      );
      handle = await client.workflow.start(salonWorkflow, {
        workflowId: taskQueue,
        taskQueue,
        args: [{ requests, openings: [] }],
      });
      const makeOpening = (
        id: string,
        stylist: string,
        offerSeconds = 900,
      ): Opening => ({
        id,
        stylist,
        service: "Haircut",
        startsAt: now + 3_600_000,
        durationMinutes: 45,
        createdAt: Date.now(),
        offerSeconds,
        demo: offerSeconds !== 900,
        reservedInSquare: true,
        status: "waiting",
        squareUpdated: false,
        offers: [],
        history: [],
      });
      await handle.executeUpdate(changeSalon, {
        args: [
          { type: "addOpening", opening: makeOpening("first", "Jessica", 2) },
        ],
      });
      let state = await handle.query(getSalon);
      const firstToken = state.openings[0].offers[0].token;
      assert.equal(state.openings[0].offers[0].clientName, "Maya");
      // Shut down before the deadline. No process is running our Workflow during the wait.
      worker.shutdown();
      await running;
      await new Promise((resolve) => setTimeout(resolve, 2200));
      worker = await Worker.create({
        connection: native,
        taskQueue,
        workflowBundle,
      });
      running = worker.run();
      state = await handle.query(getSalon);
      assert.equal(state.openings[0].offers[0].status, "expired");
      assert.equal(state.openings[0].offers[1].clientName, "Olivia");
      const secondToken = state.openings[0].offers[1].token;
      const decisions = await Promise.all([
        handle.executeUpdate(changeSalon, {
          args: [{ type: "respond", token: firstToken, response: "accept" }],
        }),
        handle.executeUpdate(changeSalon, {
          args: [{ type: "respond", token: secondToken, response: "accept" }],
        }),
        handle.executeUpdate(changeSalon, {
          args: [{ type: "respond", token: secondToken, response: "accept" }],
        }),
      ]);
      assert.equal(decisions[0].ok, false);
      assert.equal(decisions[1].ok, true);
      assert.equal(decisions[2].ok, true);
      state = await handle.query(getSalon);
      assert.equal(
        state.openings[0].offers.filter((o) => o.status === "accepted").length,
        1,
      );
      assert.equal(
        state.requests.find((r) => r.id === "Olivia")!.status,
        "fulfilled",
      );
      await handle.executeUpdate(changeSalon, {
        args: [{ type: "squareUpdated", id: "first" }],
      });
      await Promise.all([
        handle.executeUpdate(changeSalon, {
          args: [
            { type: "addOpening", opening: makeOpening("second", "Theo") },
          ],
        }),
        handle.executeUpdate(changeSalon, {
          args: [
            { type: "addOpening", opening: makeOpening("third", "Amara") },
          ],
        }),
      ]);
      state = await handle.query(getSalon);
      const pending = state.openings.flatMap((o) =>
        o.offers.filter((f) => f.status === "pending"),
      );
      assert.equal(pending.length, 2);
      assert.equal(new Set(pending.map((o) => o.clientId)).size, 2);
      const cancellation = await handle.executeUpdate(changeSalon, {
        args: [{ type: "cancelOpening", id: "second" }],
      });
      assert.equal(cancellation.ok, true);
      state = await handle.query(getSalon);
      assert.equal(
        state.openings.find((o) => o.id === "second")!.offers[0].status,
        "cancelled",
      );
      assert.equal(state.openings[0].squareUpdated, true);
      const durableState: SalonState = state;
      worker.shutdown();
      await running;
      worker = await Worker.create({
        connection: native,
        taskQueue,
        workflowBundle,
      });
      running = worker.run();
      assert.deepEqual(await handle.query(getSalon), durableState);
    } finally {
      if (handle) await handle.terminate("Integration test cleanup");
      worker.shutdown();
      await running;
      await native.close();
      await connection.close();
    }
  },
);
