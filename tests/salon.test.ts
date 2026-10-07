import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, applyCommand, matches } from "../src/salon";
import type { Opening, SalonState, WaitlistEntry } from "../src/types";

const now = 1_800_000_000_000;
const entry = (
  id: string,
  extras: Partial<WaitlistEntry> = {},
): WaitlistEntry => ({
  id,
  clientId: id,
  name: id,
  mobile: "2025550111",
  service: "Haircut",
  stylist: "Any stylist",
  durationMinutes: 45,
  availableFrom: now,
  availableUntil: now + 10_000_000,
  joinedAt: now,
  status: "waiting",
  existingAppointment: "",
  ...extras,
});
const opening = (id: string, extras: Partial<Opening> = {}): Opening => ({
  id,
  service: "Haircut",
  stylist: "Jessica",
  startsAt: now + 3_600_000,
  durationMinutes: 60,
  createdAt: now,
  offerSeconds: 900,
  demo: false,
  reservedInSquare: true,
  status: "waiting",
  squareUpdated: false,
  offers: [],
  history: [],
  ...extras,
});
let token = 0;
const nextToken = () => `token-${++token}`;
test("matches service, stylist, duration, and the entire service availability", () => {
  const o = opening("one");
  assert.equal(matches(entry("a"), o), true);
  assert.equal(matches(entry("a", { service: "Color" }), o), false);
  assert.equal(matches(entry("a", { stylist: "Theo" }), o), false);
  assert.equal(matches(entry("a", { durationMinutes: 90 }), o), false);
  assert.equal(
    matches(entry("a", { availableUntil: o.startsAt + 30 * 60_000 }), o),
    false,
  );
  assert.equal(
    matches(entry("a", { availableFrom: o.startsAt + 1 }), o),
    false,
  );
});
test("FIFO excludes ineligible clients and prevents simultaneous offers across requests for the same mobile", () => {
  const state: SalonState = {
    requests: [
      entry("later", { joinedAt: now + 1 }),
      entry("first"),
      entry("other-request", { clientId: "first", service: "Color" }),
    ],
    openings: [
      opening("one"),
      opening("two", { stylist: "Theo" }),
      opening("three", { service: "Color" }),
    ],
  };
  advance(state, now, nextToken);
  assert.equal(state.openings[0].offers[0].requestId, "first");
  assert.equal(state.openings[1].offers[0].requestId, "later");
  assert.equal(state.openings[2].status, "waiting");
  const offered = state.openings[0].offers[0];
  applyCommand(
    state,
    { type: "respond", token: offered.token, response: "decline" },
    now + 10,
  );
  advance(state, now + 10, nextToken);
  assert.equal(state.openings[2].offers[0].clientId, "first");
});
test("deadline guard rejects late acceptance and advances exactly once", () => {
  const state: SalonState = {
    requests: [entry("first"), entry("second", { joinedAt: now + 1 })],
    openings: [opening("one")],
  };
  advance(state, now, nextToken);
  const old = state.openings[0].offers[0];
  assert.equal(
    applyCommand(
      state,
      { type: "respond", token: old.token, response: "accept" },
      old.expiresAt,
    ).ok,
    false,
  );
  advance(state, old.expiresAt, nextToken);
  advance(state, old.expiresAt, nextToken);
  assert.equal(old.status, "expired");
  assert.equal(state.openings[0].offers.length, 2);
  assert.equal(state.openings[0].offers[1].requestId, "second");
});
test("acceptance is idempotent, fulfills only its request, and requires a separate Square update", () => {
  const state: SalonState = {
    requests: [entry("first"), entry("second")],
    openings: [opening("one")],
  };
  advance(state, now, nextToken);
  const command = {
    type: "respond" as const,
    token: state.openings[0].offers[0].token,
    response: "accept" as const,
  };
  assert.equal(applyCommand(state, command, now + 1).ok, true);
  assert.equal(applyCommand(state, command, now + 2).ok, true);
  advance(state, now + 3, nextToken);
  assert.equal(state.openings[0].offers.length, 1);
  assert.equal(state.requests[0].status, "fulfilled");
  assert.equal(state.requests[1].status, "waiting");
  assert.equal(state.openings[0].squareUpdated, false);
  assert.equal(
    applyCommand(state, { type: "squareUpdated", id: "one" }, now + 5).ok,
    true,
  );
});
test("withdrawal targets an exact offer; cancelling an opening closes all links", () => {
  const state: SalonState = {
    requests: [entry("first"), entry("second", { joinedAt: now + 1 })],
    openings: [opening("one")],
  };
  advance(state, now, nextToken);
  const first = state.openings[0].offers[0];
  applyCommand(
    state,
    { type: "cancelOffer", id: "one", offerId: first.id },
    now + 1,
  );
  advance(state, now + 1, nextToken);
  assert.equal(
    applyCommand(
      state,
      { type: "cancelOffer", id: "one", offerId: first.id },
      now + 2,
    ).ok,
    false,
  );
  assert.equal(state.openings[0].offers[1].status, "pending");
  applyCommand(state, { type: "cancelOpening", id: "one" }, now + 3);
  advance(state, now + 4, nextToken);
  for (const offer of state.openings[0].offers)
    assert.equal(
      applyCommand(
        state,
        { type: "respond", token: offer.token, response: "accept" },
        now + 5,
      ).ok,
      false,
    );
  assert.equal(state.openings[0].status, "cancelled");
});
test("outreach stops at appointment time, or immediately if no eligible clients remain", () => {
  const state: SalonState = {
    requests: [entry("first")],
    openings: [
      opening("one", { startsAt: now + 1000 }),
      opening("two", { service: "Color" }),
    ],
  };
  advance(state, now, nextToken);
  assert.equal(state.openings[0].offers[0].expiresAt, now + 1000);
  assert.equal(state.openings[1].status, "unfilled");
  advance(state, now + 1000, nextToken);
  assert.equal(state.openings[0].status, "unfilled");
  assert.equal(state.requests[0].status, "waiting");
});
test("duplicate Square slot and missing reservation are rejected", () => {
  const state: SalonState = { requests: [], openings: [opening("one")] };
  assert.equal(
    applyCommand(state, { type: "addOpening", opening: opening("two") }, now)
      .ok,
    false,
  );
  assert.equal(
    applyCommand(
      state,
      {
        type: "addOpening",
        opening: opening("three", { stylist: "Theo", reservedInSquare: false }),
      },
      now,
    ).ok,
    false,
  );
});
test("removing a request withdraws its active offer and moves on", () => {
  const state: SalonState = {
    requests: [entry("first"), entry("second", { joinedAt: now + 1 })],
    openings: [opening("one")],
  };
  advance(state, now, nextToken);
  applyCommand(state, { type: "removeRequest", id: "first" }, now + 1);
  advance(state, now + 1, nextToken);
  assert.equal(state.openings[0].offers[0].status, "cancelled");
  assert.equal(state.openings[0].offers[1].requestId, "second");
});
