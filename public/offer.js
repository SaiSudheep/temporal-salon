const token = new URLSearchParams(location.search).get("token");
const content = document.querySelector("#client-content");
const banner = document.querySelector("#client-connection");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let offer,
  signature,
  offset = 0,
  busy = false,
  polling = false;
const time = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
function effectiveStatus() {
  return offer.status === "pending" && offer.expiresAt <= Date.now() + offset
    ? "expired"
    : offer.status;
}
function tick() {
  if (!offer) return;
  const el = document.querySelector("[data-countdown]");
  if (el) {
    const seconds = Math.max(
      0,
      Math.ceil((offer.expiresAt - Date.now() - offset) / 1000),
    );
    el.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const next = JSON.stringify([offer, effectiveStatus()]);
  if (next !== signature && !busy) {
    signature = next;
    render();
  }
}
function render() {
  const status = effectiveStatus();
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(offer.startsAt);
  const appointment = `<div class="client-appointment"><p>${esc(date)}</p><strong>${time(offer.startsAt)}</strong><p>${esc(offer.service)} · ${offer.durationMinutes} minutes<br>with ${esc(offer.stylist)}</p></div>`;
  let html;
  if (status === "pending")
    html = `<span class="client-icon">✧</span><p class="eyebrow">A LITTLE ROOM JUST OPENED UP</p><h1>A moment for you,<br>${esc(offer.clientName.split(" ")[0])}.</h1><p class="intro">We thought of you when this appointment became available. We'd love to see you.</p>${appointment}<p class="client-deadline">Held just for you for <strong data-countdown></strong></p>${offer.demo ? '<p class="client-warning">Demo offer · this invitation expires after 20 seconds.</p>' : ""}<div class="client-buttons"><button class="button primary" data-response="accept">Yes, I'd love this appointment</button><button class="button secondary" data-response="decline">Not this time</button></div><p class="client-footnote">Declining keeps you on the waitlist for another opening.</p>`;
  else if (status === "accepted")
    html = `<span class="client-icon">✓</span><p class="eyebrow">SOMETHING TO LOOK FORWARD TO</p><h1>It's yours, ${esc(offer.clientName.split(" ")[0])}.</h1><p class="intro">Your appointment has been accepted. We look forward to seeing you.</p>${appointment}<p class="client-warning">${offer.squareUpdated ? "The salon has finished updating its calendar." : "The salon is still updating its calendar. Staff will also handle any changes to your previous appointment."}</p>`;
  else if (status === "declined")
    html = `<span class="client-icon">♡</span><p class="eyebrow">ANOTHER TIME, THEN</p><h1>We'll keep you in mind.</h1><p class="intro">Thanks for letting us know. You're still on the waitlist, and we'll be in touch when another suitable appointment opens up.</p>`;
  else
    html = `<span class="client-icon">${status === "cancelled" ? "♡" : "◷"}</span><p class="eyebrow">THIS INVITATION HAS CLOSED</p><h1>Another opportunity will come.</h1><p class="intro">${status === "cancelled" ? "We're sorry for the change. This opening is no longer available and this offer cannot be accepted." : "The response window has ended, so this offer is no longer available."}</p><p class="client-footnote">If your waitlist request is still active, we'll keep you in mind for another opening. Contact the salon if you'd like to change your request.</p>`;
  content.innerHTML =
    html + '<p id="response-error" class="form-error" role="alert"></p>';
  const counter = document.querySelector("[data-countdown]");
  if (counter) {
    const seconds = Math.max(
      0,
      Math.ceil((offer.expiresAt - Date.now() - offset) / 1000),
    );
    counter.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
}
async function refresh() {
  if (polling || busy) return;
  polling = true;
  try {
    if (!token)
      throw new Error(
        "Your invitation link is missing. Please contact the salon.",
      );
    const response = await fetch(`/api/offers/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    offset = data.serverNow - Date.now();
    delete data.serverNow;
    offer = data;
    banner.hidden = true;
    tick();
  } catch (error) {
    banner.hidden = false;
    banner.textContent =
      error.message ||
      "We are reconnecting. Your appointment has not been confirmed here yet.";
  } finally {
    polling = false;
  }
}
content.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-response]");
  if (!button || busy) return;
  busy = true;
  content.querySelectorAll("button").forEach((b) => (b.disabled = true));
  let failure;
  try {
    const response = await fetch(`/api/offers/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ response: button.dataset.response }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    offer.status =
      button.dataset.response === "accept" ? "accepted" : "declined";
  } catch (error) {
    failure = error.message;
  } finally {
    busy = false;
    signature = undefined;
    tick();
    await refresh();
    if (failure) {
      const el = document.querySelector("#response-error");
      if (el) el.textContent = failure;
    }
    content.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});
refresh();
setInterval(refresh, 1500);
setInterval(tick, 500);
