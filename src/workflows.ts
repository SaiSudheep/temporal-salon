import {
  condition,
  continueAsNew,
  defineQuery,
  defineUpdate,
  setHandler,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";
import { advance, applyCommand, nextWakeup } from "./salon";
import type { Command, CommandResult, PublicOffer, SalonState } from "./types";

export const getSalon = defineQuery<SalonState>("getSalon");
export const getOffer = defineQuery<PublicOffer | null, [string]>("getOffer");
export const changeSalon = defineUpdate<CommandResult, [Command]>(
  "changeSalon",
);

// One durable coordinator makes cross-opening client claims atomic for this small salon.
// Handlers never await: responses, cancellation and reservations cannot interleave.
export async function salonWorkflow(state: SalonState): Promise<void> {
  let revision = 0;
  setHandler(getSalon, () => state);
  setHandler(getOffer, (token) => {
    const opening = state.openings.find((o) =>
      o.offers.some((f) => f.token === token),
    );
    const offer = opening?.offers.find((o) => o.token === token);
    if (!opening || !offer) return null;
    return {
      clientName: offer.clientName,
      service: opening.service,
      stylist: opening.stylist,
      startsAt: opening.startsAt,
      durationMinutes: state.requests.find((r) => r.id === offer.requestId)!
        .durationMinutes,
      expiresAt: offer.expiresAt,
      status: offer.status,
      squareUpdated: opening.squareUpdated,
      demo: opening.demo,
    };
  });
  setHandler(changeSalon, (command) => {
    // Check deadlines before every command, including after worker downtime.
    advance(state, Date.now(), uuid4);
    const result = applyCommand(state, command, Date.now());
    advance(state, Date.now(), uuid4);
    revision++;
    return result;
  });
  while (true) {
    advance(state, Date.now(), uuid4);
    if (workflowInfo().continueAsNewSuggested)
      await continueAsNew<typeof salonWorkflow>(state);
    const before = revision;
    await condition(() => revision !== before, nextWakeup(state, Date.now()));
  }
}
