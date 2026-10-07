import type {
  Command,
  CommandResult,
  Offer,
  Opening,
  SalonState,
  WaitlistEntry,
} from "./types";

export function matches(entry: WaitlistEntry, opening: Opening): boolean {
  return (
    entry.status === "waiting" &&
    entry.service === opening.service &&
    (entry.stylist === "Any stylist" || entry.stylist === opening.stylist) &&
    entry.durationMinutes <= opening.durationMinutes &&
    entry.availableFrom <= opening.startsAt &&
    entry.availableUntil >= opening.startsAt + entry.durationMinutes * 60_000
  );
}

function record(opening: Opening, now: number, message: string) {
  opening.history.push({ at: now, message });
}

function finishOffer(
  opening: Opening,
  offer: Offer,
  status: Offer["status"],
  now: number,
  message: string,
) {
  offer.status = status;
  offer.respondedAt = now;
  record(opening, now, message);
}

// All decisions are synchronous: no external calls may interleave a reservation or acceptance.
export function advance(
  state: SalonState,
  now: number,
  newToken: () => string,
): void {
  for (const opening of state.openings) {
    if (!["offering", "waiting"].includes(opening.status)) continue;
    const active = opening.offers.find((o) => o.status === "pending");
    if (active && (active.expiresAt <= now || opening.startsAt <= now)) {
      finishOffer(
        opening,
        active,
        "expired",
        now,
        `${active.clientName}'s offer expired without a response.`,
      );
    }
    if (opening.startsAt <= now) {
      opening.status = "unfilled";
      record(
        opening,
        now,
        "Outreach ended because the appointment start time was reached.",
      );
    }
  }
  const busy = new Set(
    state.openings.flatMap((o) =>
      o.offers.filter((f) => f.status === "pending").map((f) => f.clientId),
    ),
  );
  for (const opening of state.openings) {
    if (
      !["offering", "waiting"].includes(opening.status) ||
      opening.offers.some((o) => o.status === "pending")
    )
      continue;
    const tried = new Set(opening.offers.map((o) => o.requestId));
    const candidates = state.requests
      .filter((r) => matches(r, opening) && !tried.has(r.id))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const next = candidates.find((r) => !busy.has(r.clientId));
    if (!next) {
      const status = candidates.length ? "waiting" : "unfilled";
      if (opening.status !== status)
        record(
          opening,
          now,
          candidates.length
            ? "Eligible clients are considering other offers. Waiting for them to become available."
            : "No eligible clients remain. Outreach ended without filling this opening.",
        );
      opening.status = status;
      continue;
    }
    const token = newToken();
    opening.offers.push({
      id: token,
      token,
      requestId: next.id,
      clientId: next.clientId,
      clientName: next.name,
      createdAt: now,
      expiresAt: Math.min(now + opening.offerSeconds * 1000, opening.startsAt),
      status: "pending",
    });
    opening.status = "offering";
    busy.add(next.clientId);
    record(
      opening,
      now,
      `Offer sent to ${next.name}. Simulated text is ready.`,
    );
  }
}

export function applyCommand(
  state: SalonState,
  command: Command,
  now: number,
): CommandResult {
  const ok = (message: string, id?: string): CommandResult => ({
    ok: true,
    message,
    id,
  });
  const no = (message: string): CommandResult => ({ ok: false, message });
  if (command.type === "addRequest") {
    if (state.requests.some((r) => r.id === command.entry.id))
      return ok("Request already saved.", command.entry.id);
    if (
      state.requests.some(
        (r) =>
          r.status === "waiting" &&
          r.clientId === command.entry.clientId &&
          r.service === command.entry.service,
      )
    )
      return no("This client already has a waitlist request for that service.");
    state.requests.push(command.entry);
    return ok("Client added to the waitlist.", command.entry.id);
  }
  if (command.type === "removeRequest") {
    const entry = state.requests.find((r) => r.id === command.id);
    if (!entry) return no("Waitlist request not found.");
    if (entry.status === "fulfilled")
      return no("This request has already been filled.");
    entry.status = "removed";
    for (const opening of state.openings) {
      const active = opening.offers.find(
        (o) => o.status === "pending" && o.requestId === entry.id,
      );
      if (active)
        finishOffer(
          opening,
          active,
          "cancelled",
          now,
          `${entry.name}'s offer was withdrawn when staff removed their request.`,
        );
    }
    return ok("Request removed; any active offer has been withdrawn.");
  }
  if (command.type === "addOpening") {
    const opening = command.opening;
    if (state.openings.some((o) => o.id === opening.id))
      return ok("Opening already saved.", opening.id);
    if (!opening.reservedInSquare)
      return no("Check and reserve this opening in Square first.");
    if (opening.startsAt <= now)
      return no("The opening must start in the future.");
    if (
      state.openings.some(
        (o) =>
          o.stylist === opening.stylist &&
          o.status !== "cancelled" &&
          o.status !== "unfilled" &&
          o.startsAt < opening.startsAt + opening.durationMinutes * 60_000 &&
          opening.startsAt < o.startsAt + o.durationMinutes * 60_000,
      )
    )
      return no(
        "This stylist already has an overlapping opening or accepted appointment here.",
      );
    state.openings.push(opening);
    record(
      opening,
      now,
      "Staff confirmed the time is reserved in Square. Outreach started.",
    );
    return ok("Opening created. Outreach has started.", opening.id);
  }
  if (command.type === "respond") {
    const opening = state.openings.find((o) =>
      o.offers.some((f) => f.token === command.token),
    );
    const offer = opening?.offers.find((o) => o.token === command.token);
    if (!opening || !offer) return no("This offer could not be found.");
    if (offer.status === "accepted" && command.response === "accept")
      return ok("Your appointment is accepted.", opening.id);
    if (offer.status === "declined" && command.response === "decline")
      return ok("Your decline was received. You remain on the waitlist.");
    if (
      offer.status !== "pending" ||
      opening.status !== "offering" ||
      offer.expiresAt <= now ||
      opening.startsAt <= now
    )
      return no(
        "This offer is no longer available. You remain on the waitlist unless staff removed your request.",
      );
    if (command.response === "decline") {
      finishOffer(
        opening,
        offer,
        "declined",
        now,
        `${offer.clientName} declined. Their request remains on the waitlist.`,
      );
      return ok("Offer declined. You remain on the waitlist.");
    }
    finishOffer(
      opening,
      offer,
      "accepted",
      now,
      `${offer.clientName} accepted. Square update pending.`,
    );
    opening.status = "filled";
    state.requests.find((r) => r.id === offer.requestId)!.status = "fulfilled";
    return ok(
      "Your appointment is accepted. The salon is updating its calendar.",
      opening.id,
    );
  }
  const opening = state.openings.find((o) => o.id === command.id);
  if (!opening) return no("Opening not found.");
  if (command.type === "squareUpdated") {
    if (opening.status !== "filled")
      return no(
        "Only an accepted appointment can be marked updated in Square.",
      );
    if (!opening.squareUpdated)
      record(opening, now, "Staff marked the Square calendar update complete.");
    opening.squareUpdated = true;
    return ok("Square update marked complete.");
  }
  if (!["offering", "waiting"].includes(opening.status))
    return no("Outreach is no longer active.");
  const active = opening.offers.find((o) => o.status === "pending");
  if (command.type === "cancelOffer") {
    if (!active || active.id !== command.offerId)
      return no(
        "That offer is no longer active. Refresh to see the current offer.",
      );
    finishOffer(
      opening,
      active,
      "cancelled",
      now,
      `Staff withdrew ${active.clientName}'s offer and moved to the next client.`,
    );
    return ok("Offer withdrawn. Moving to the next eligible client.");
  }
  if (active)
    finishOffer(
      opening,
      active,
      "cancelled",
      now,
      `Offer to ${active.clientName} withdrawn. The opening is no longer available.`,
    );
  opening.status = "cancelled";
  record(
    opening,
    now,
    "Staff cancelled this opening. All offer links are closed.",
  );
  return ok(
    "Opening cancelled. The client offer page now explains the change.",
  );
}

export function nextWakeup(state: SalonState, now: number): number {
  const deadlines = state.openings
    .filter((o) => ["offering", "waiting"].includes(o.status))
    .flatMap((o) => [
      o.startsAt,
      ...o.offers.filter((f) => f.status === "pending").map((f) => f.expiresAt),
    ]);
  return Math.max(1, Math.min(86_400_000, ...deadlines.map((d) => d - now)));
}
