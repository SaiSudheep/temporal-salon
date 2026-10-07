export const SERVICES = ["Haircut", "Color", "Blowout"] as const;
export const STYLISTS = ["Jessica", "Theo", "Amara"] as const;
export const SALON_TIME_ZONE = "America/Los_Angeles";
export type Service = (typeof SERVICES)[number];
export type WaitlistEntry = {
  id: string;
  clientId: string;
  name: string;
  mobile: string;
  service: Service;
  stylist: string;
  durationMinutes: number;
  availableFrom: number;
  availableUntil: number;
  joinedAt: number;
  status: "waiting" | "fulfilled" | "removed";
  existingAppointment: string;
};
export type Offer = {
  id: string;
  token: string;
  requestId: string;
  clientId: string;
  clientName: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  respondedAt?: number;
};
export type Opening = {
  id: string;
  service: Service;
  stylist: string;
  startsAt: number;
  durationMinutes: number;
  createdAt: number;
  offerSeconds: number;
  demo: boolean;
  reservedInSquare: boolean;
  status: "offering" | "waiting" | "filled" | "unfilled" | "cancelled";
  squareUpdated: boolean;
  offers: Offer[];
  history: { at: number; message: string }[];
};
export type SalonState = { requests: WaitlistEntry[]; openings: Opening[] };
export type Command =
  | { type: "addRequest"; entry: WaitlistEntry }
  | { type: "removeRequest"; id: string }
  | { type: "addOpening"; opening: Opening }
  | { type: "respond"; token: string; response: "accept" | "decline" }
  | { type: "cancelOffer"; id: string; offerId: string }
  | { type: "cancelOpening"; id: string }
  | { type: "squareUpdated"; id: string };
export type CommandResult = { ok: boolean; message: string; id?: string };
export type PublicOffer = {
  clientName: string;
  service: Service;
  stylist: string;
  startsAt: number;
  durationMinutes: number;
  expiresAt: number;
  status: Offer["status"];
  squareUpdated: boolean;
  demo: boolean;
};
