import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { changeSalon, getOffer, getSalon, salonWorkflow } from "./workflows";
import { matches } from "./salon";
import {
  SALON_TIME_ZONE,
  SERVICES,
  STYLISTS,
  type Command,
  type Service,
  type WaitlistEntry,
} from "./types";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "24kb" }));
app.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.static(path.join(process.cwd(), "public")));
const workflowId = process.env.SALON_WORKFLOW_ID ?? "juniper-salon-v1";
const taskQueue = process.env.SALON_TASK_QUEUE ?? "juniper-salon";
let clientPromise: Promise<Client> | undefined;
let ready: Promise<void> | undefined;

function getClient() {
  clientPromise ??= Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  })
    .then((connection) => new Client({ connection, namespace: "default" }))
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  return clientPromise;
}
async function salon() {
  const client = await getClient();
  ready ??= client.workflow
    .start(salonWorkflow, {
      workflowId,
      taskQueue,
      args: [{ requests: [], openings: [] }],
    })
    .then(() => {})
    .catch((error) => {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        ready = undefined;
        throw error;
      }
    });
  await ready;
  return {
    client,
    handle: client.workflow.getHandle<typeof salonWorkflow>(workflowId),
  };
}
async function change(command: Command, request: Request) {
  const { client, handle } = await salon();
  // An acknowledgement means the worker has validated and applied this Update.
  const updateId =
    request.get("Idempotency-Key")?.slice(0, 100) || randomUUID();
  return client.connection.withDeadline(Date.now() + 10_000, () =>
    handle.executeUpdate(changeSalon, { args: [command], updateId }),
  );
}
class InputError extends Error {}
function text(value: unknown, field: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new InputError(`Enter a valid ${field}.`);
  return value.trim();
}
function number(value: unknown, field: string, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new InputError(`Enter a valid ${field}.`);
  return value;
}
function service(value: unknown): Service {
  if (!SERVICES.includes(value as Service))
    throw new InputError("Choose a listed service.");
  return value as Service;
}
function stylist(value: unknown, allowAny = false) {
  if (
    !STYLISTS.includes(value as (typeof STYLISTS)[number]) &&
    !(allowAny && value === "Any stylist")
  )
    throw new InputError("Choose a listed stylist.");
  return value as string;
}
const dateKey = (time: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SALON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);

app.get("/api/salon", async (_request, response) => {
  const { client, handle } = await salon();
  const state = await client.connection.withDeadline(Date.now() + 8_000, () =>
    handle.query(getSalon),
  );
  const busy = new Set(
    state.openings.flatMap((o) =>
      o.offers.filter((f) => f.status === "pending").map((f) => f.clientId),
    ),
  );
  response.setHeader("Cache-Control", "no-store");
  response.json({
    ...state,
    timeZone: SALON_TIME_ZONE,
    serverNow: Date.now(),
    services: SERVICES,
    stylists: STYLISTS,
    openings: state.openings.map((o) => ({
      ...o,
      candidates: state.requests
        .filter(
          (r) => matches(r, o) && !o.offers.some((f) => f.requestId === r.id),
        )
        .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
        .map((r) => ({ id: r.id, name: r.name, busy: busy.has(r.clientId) })),
    })),
  });
});
app.post("/api/waitlist", async (request, response) => {
  const body = request.body ?? {};
  const mobile = text(body.mobile, "mobile number", 30);
  let normalized = mobile.replace(/\D/g, "");
  if (normalized.length === 10) normalized = "1" + normalized;
  if (normalized.length < 7 || normalized.length > 15)
    throw new InputError("Enter a mobile number with 7 to 15 digits.");
  const availableFrom = number(
    body.availableFrom,
    "availability start",
    0,
    9e12,
  );
  const availableUntil = number(
    body.availableUntil,
    "availability end",
    Date.now(),
    9e12,
  );
  const durationMinutes = number(
    body.durationMinutes,
    "service duration",
    5,
    480,
  );
  if (availableUntil - availableFrom < durationMinutes * 60_000)
    throw new InputError(
      "The full service must fit inside the availability window.",
    );
  const entry: WaitlistEntry = {
    id: randomUUID(),
    clientId: normalized,
    name: text(body.name, "client name", 80),
    mobile,
    service: service(body.service),
    stylist: stylist(body.stylist, true),
    durationMinutes,
    availableFrom,
    availableUntil,
    joinedAt: Date.now(),
    status: "waiting",
    existingAppointment:
      typeof body.existingAppointment === "string"
        ? body.existingAppointment.slice(0, 200).trim()
        : "",
  };
  const result = await change({ type: "addRequest", entry }, request);
  response.status(result.ok ? 201 : 409).json(result);
});
app.delete("/api/waitlist/:id", async (req, res) => {
  const result = await change(
    { type: "removeRequest", id: String(req.params.id) },
    req,
  );
  res.status(result.ok ? 200 : 409).json(result);
});
app.post("/api/openings", async (req, res) => {
  const body = req.body ?? {};
  const startsAt = number(
    body.startsAt,
    "future start time",
    Date.now() + 1000,
    Date.now() + 86_400_000,
  );
  const durationMinutes = number(
    body.durationMinutes,
    "opening duration",
    5,
    480,
  );
  if (
    dateKey(startsAt) !== dateKey(Date.now()) ||
    dateKey(startsAt + durationMinutes * 60_000) !== dateKey(startsAt)
  )
    throw new InputError(
      "This prototype handles appointments that start and finish today, in Pacific time.",
    );
  const result = await change(
    {
      type: "addOpening",
      opening: {
        id: randomUUID(),
        service: service(body.service),
        stylist: stylist(body.stylist),
        startsAt,
        durationMinutes,
        createdAt: Date.now(),
        offerSeconds: body.demo === true ? 20 : 900,
        demo: body.demo === true,
        reservedInSquare: body.reservedInSquare === true,
        status: "waiting",
        squareUpdated: false,
        offers: [],
        history: [],
      },
    },
    req,
  );
  res.status(result.ok ? 201 : 409).json(result);
});
app.post("/api/openings/:id/:action", async (req, res) => {
  const id = String(req.params.id);
  const action = req.params.action;
  let command: Command;
  if (action === "cancel") command = { type: "cancelOpening", id };
  else if (action === "next")
    command = {
      type: "cancelOffer",
      id,
      offerId: text(req.body?.offerId, "offer ID"),
    };
  else if (action === "square") command = { type: "squareUpdated", id };
  else {
    res.status(404).json({ message: "Action not found." });
    return;
  }
  const result = await change(command, req);
  res.status(result.ok ? 200 : 409).json(result);
});
app.get("/api/offers/:token", async (req, res) => {
  const { client, handle } = await salon();
  const offer = await client.connection.withDeadline(Date.now() + 8_000, () =>
    handle.query(getOffer, String(req.params.token)),
  );
  res.setHeader("Cache-Control", "no-store");
  if (!offer) {
    res
      .status(404)
      .json({
        message: "This offer could not be found. Please contact the salon.",
      });
    return;
  }
  res.json({ ...offer, serverNow: Date.now(), timeZone: SALON_TIME_ZONE });
});
app.post("/api/offers/:token", async (req, res) => {
  if (!["accept", "decline"].includes(req.body?.response))
    throw new InputError("Choose accept or decline.");
  const result = await change(
    {
      type: "respond",
      token: String(req.params.token),
      response: req.body.response,
    },
    req,
  );
  res.status(result.ok ? 200 : 409).json(result);
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (
    error instanceof InputError ||
    (error instanceof SyntaxError && "body" in error)
  ) {
    res.status(400).json({ message: error.message });
    return;
  }
  console.error(error);
  res
    .status(503)
    .json({
      message:
        "We couldn't confirm that action right now. Reconnecting to the salon; refresh to check its status before trying again.",
    });
});
const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port);
server.once("listening", () =>
  console.log(`Juniper Salon is available at http://localhost:${port}`),
);
server.once("error", (error) => {
  console.error(`Could not start Juniper on port ${port}:`, error.message);
  process.exitCode = 1;
});
