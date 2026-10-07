const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const zone = "America/Los_Angeles";
const dateKey = (value = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
const time = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
const day = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
  }).format(value);
const initials = (name) =>
  name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
function atPacific(date, clock) {
  const target = Date.parse(`${date}T${clock}:00Z`);
  let value = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(value)
        .map((p) => [p.type, p.value]),
    );
    const represented = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    value += target - represented;
  }
  return value;
}
let state = { requests: [], openings: [] },
  selectedId,
  currentView = "openings",
  offset = 0,
  lastSignature = "",
  refreshing = false;
let toastTimer;
const labels = {
  offering: "Offer in progress",
  waiting: "Waiting for a client",
  filled: "Filled",
  unfilled: "Unfilled",
  cancelled: "Cancelled",
  pending: "Considering",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Timed out",
};
const badge = (status) =>
  `<span class="badge ${esc(status)}">${esc(labels[status] || status)}</span>`;
const activeOffer = (o) => o.offers.find((f) => f.status === "pending");
const now = () => Date.now() + offset;
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.method ? { "Idempotency-Key": crypto.randomUUID() } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Something went wrong. Please try again.");
  return data;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast${error ? " error" : ""}`;
  element.hidden = false;
  toastTimer = setTimeout(() => (element.hidden = true), error ? 8000 : 4500);
}
function countdown(expiresAt) {
  const left = Math.max(0, Math.ceil((expiresAt - now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
function updateClocks() {
  document
    .querySelectorAll("[data-deadline]")
    .forEach((el) => (el.textContent = countdown(Number(el.dataset.deadline))));
}
function setView(view) {
  currentView = view;
  ["openings", "waitlist", "guide"].forEach(
    (name) => ($(`#${name}-view`).hidden = name !== view),
  );
  document
    .querySelectorAll("[data-view]")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === view));
}
function render() {
  const today = state.openings.filter((o) => dateKey(o.startsAt) === dateKey());
  const active = today.filter((o) =>
    ["offering", "waiting"].includes(o.status),
  );
  const filled = today.filter((o) => o.status === "filled");
  $("#nav-count").textContent = active.length;
  $("#stat-active").textContent = active.length;
  $("#stat-filled").textContent = filled.length;
  $("#stat-square").textContent = state.openings.filter(
    (o) => o.status === "filled" && !o.squareUpdated,
  ).length;
  $("#stat-rate").textContent = today.length
    ? `${Math.round((filled.length / today.length) * 100)}% filled · goal: at least 50%`
    : "Every filled chair counts";
  $("#opening-count").textContent = today.length;
  const filter = $("#opening-filter").value;
  const list = today
    .filter(
      (o) =>
        filter === "all" ||
        (filter === "active" && ["offering", "waiting"].includes(o.status)) ||
        (filter === "filled" && o.status === "filled") ||
        (filter === "closed" && ["cancelled", "unfilled"].includes(o.status)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!selectedId && list.length) selectedId = list[0].id;
  $("#opening-list").innerHTML = list.length
    ? list
        .map((o) => {
          const offer = activeOffer(o);
          const accepted = o.offers.find((f) => f.status === "accepted");
          return `<button class="opening-card ${o.id === selectedId ? "selected" : ""}" data-opening="${esc(o.id)}" aria-pressed="${o.id === selectedId}"><div class="card-top"><span class="appointment-time">${time(o.startsAt)}</span>${badge(o.status)}</div><div class="card-service">${esc(o.service)} <span aria-hidden="true">·</span> ${o.durationMinutes} min</div><div class="card-sub">with ${esc(o.stylist)}${o.demo ? " · 20-second demo" : ""}</div><div class="card-bottom"><span>${offer ? `Waiting for ${esc(offer.clientName.split(" ")[0])}` : accepted ? `Accepted by ${esc(accepted.clientName.split(" ")[0])}` : o.status === "waiting" ? "Matching clients are busy" : "View the story"}</span><span>${offer ? `<span data-deadline="${offer.expiresAt}">${countdown(offer.expiresAt)}</span> left` : accepted && !o.squareUpdated ? "Square update pending" : "↗"}</span></div></button>`;
        })
        .join("")
    : `<div class="empty-state small"><h2>A little breathing room.</h2><p>${filter === "all" ? "When a cancellation comes in, add the opening here. We’ll take it from there." : "No openings with this status."}</p>${filter === "all" ? '<button class="button secondary" data-action="new-opening">Create your first opening</button>' : ""}</div>`;
  renderDetail();
  renderWaitlist();
  updateClocks();
}
function renderDetail() {
  const o = state.openings.find((o) => o.id === selectedId);
  if (!o) {
    $("#opening-detail").innerHTML =
      `<div class="empty-state"><div class="empty-illustration"><svg viewBox="0 0 110 110" fill="none" aria-hidden="true"><circle cx="55" cy="55" r="52" fill="#edf1e5"/><path d="M32 77h47M40 77V52c0-12 30-12 30 0v25M34 62h42M55 77v13M45 91h20" stroke="#7d906d" stroke-width="2.5" stroke-linecap="round"/><path d="M74 37c-8-2-8-9-5-13 7 1 10 7 5 13ZM76 41c0-8 6-12 11-10 0 7-4 11-11 10Z" fill="#b8c7a5"/></svg></div><p class="eyebrow">ONE OPENING. ONE OFFER AT A TIME.</p><h2>A thoughtful way to fill the day.</h2><p>Select an opening to see who’s considering it, who’s next, and every little step along the way.</p><span class="empty-note">Your Square calendar stays yours</span></div>`;
    return;
  }
  const offer = activeOffer(o),
    accepted = o.offers.find((f) => f.status === "accepted");
  const entry = accepted
    ? state.requests.find((r) => r.id === accepted.requestId)
    : null;
  let highlight = "";
  if (offer)
    highlight = `<div class="offer-highlight"><div class="mini-heading">CURRENT OFFER</div><div class="offer-person"><span class="avatar">${esc(initials(offer.clientName))}</span><div><strong>${esc(offer.clientName)}</strong><p>Holding this opening just for them</p></div><div class="countdown"><span data-deadline="${offer.expiresAt}">${countdown(offer.expiresAt)}</span><small>TO RESPOND</small></div></div><div class="offer-actions"><a class="button" href="/offer.html?token=${encodeURIComponent(offer.token)}" target="_blank" rel="noopener">Open client offer ↗</a><button class="text-button" data-action="next" data-id="${esc(o.id)}" data-offer="${esc(offer.id)}">Withdraw & move on</button></div><div class="message-preview"><small>SIMULATED TEXT · NO SMS SENT</small>Hi ${esc(offer.clientName.split(" ")[0])}, a ${esc(o.service.toLowerCase())} with ${esc(o.stylist)} opened up at ${time(o.startsAt)} today. It's yours if you'd like it. Please respond by ${time(offer.expiresAt)} using your offer link.</div>${o.demo ? '<span class="demo-badge">DEMO · 20-second response window</span>' : ""}</div>`;
  else if (accepted)
    highlight = `<div class="offer-highlight"><div class="mini-heading">A CHAIR FILLED. A DAY MADE.</div><div class="offer-person"><span class="avatar">✓</span><div><strong>${esc(accepted.clientName)}</strong><p>Accepted at ${time(accepted.respondedAt)}</p></div></div></div><div class="square-card"><h3>${o.squareUpdated ? "✓ Square calendar updated" : "Square update pending"}</h3><p>${o.squareUpdated ? "Staff marked the calendar update complete." : "The client has accepted. Add this appointment to Square and adjust any existing booking."}${entry?.existingAppointment ? `<br>Existing booking: ${esc(entry.existingAppointment)}` : ""}</p>${!o.squareUpdated ? `<button class="button" data-action="square" data-id="${esc(o.id)}">I've updated Square ✓</button>` : ""}</div>`;
  else
    highlight = `<div class="offer-highlight"><h3>${o.status === "waiting" ? "Giving each client their space." : o.status === "cancelled" ? "This opening has been cancelled." : "Outreach has ended."}</h3><p class="muted" style="margin-bottom:0">${o.status === "waiting" ? "Eligible clients are considering other offers. Outreach will resume automatically when one becomes available." : o.status === "cancelled" ? "All offer links are closed. The client page explains the change and offers an apology." : "No appointment was confirmed. Check the history below and manage this time in Square."}</p></div>`;
  const candidates = o.candidates ?? [];
  $("#opening-detail").innerHTML =
    `<div class="detail-heading"><div><p class="eyebrow">${day(o.startsAt).toUpperCase()} · OPENING DETAILS</p><h2>${esc(o.service)} at ${time(o.startsAt)}</h2><p>${o.durationMinutes} minutes with ${esc(o.stylist)}</p></div>${badge(o.status)}</div><div class="detail-body">${highlight}${["offering", "waiting"].includes(o.status) ? `<section class="detail-section"><h3>Next in line <span>Earliest eligible request first</span></h3>${candidates.length ? candidates.map((r, i) => `<div class="candidate"><span class="position">${String(i + 1).padStart(2, "0")}</span><span>${esc(r.name)}</span><small>${r.busy ? "Considering another offer" : "Ready if needed"}</small></div>`).join("") : '<p class="muted">No additional eligible clients for this opening.</p>'}</section>` : ""}<section class="detail-section"><h3>The story so far <span>${o.offers.length} offer${o.offers.length === 1 ? "" : "s"}</span></h3><ol class="timeline">${[
      ...o.history,
    ]
      .reverse()
      .map((h) => `<li>${esc(h.message)}<time>${time(h.at)}</time></li>`)
      .join(
        "",
      )}</ol></section>${o.offers.length ? `<details class="detail-section"><summary class="muted">Simulated messages & previous offer links</summary>${o.offers.map((f) => `<div class="candidate"><span>${esc(f.clientName)}</span>${badge(f.status)}<a class="offer-link-history" href="/offer.html?token=${encodeURIComponent(f.token)}" target="_blank" rel="noopener">View link ↗</a></div>${f.status === "cancelled" ? '<p class="form-hint">Simulated follow-up: Sorry, this opening is no longer available. Your previous offer cannot be accepted.</p>' : ""}`).join("")}</details>` : ""}</div><div class="detail-footer"><span>${o.reservedInSquare ? "✓ Staff checked the Square reservation" : ""}</span>${["offering", "waiting"].includes(o.status) ? `<button class="text-button destructive" data-action="cancel" data-id="${esc(o.id)}">Cancel opening</button>` : ""}</div>`;
}
function renderWaitlist() {
  const search = $("#client-search").value.toLowerCase();
  const waiting = state.requests
    .filter((r) => r.status === "waiting")
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const list = waiting.filter((r) =>
    `${r.name} ${r.mobile} ${r.service}`.toLowerCase().includes(search),
  );
  const busy = new Set(
    state.openings.flatMap((o) =>
      o.offers.filter((f) => f.status === "pending").map((f) => f.clientId),
    ),
  );
  $("#waitlist-count").textContent =
    `${waiting.length} client request${waiting.length === 1 ? "" : "s"} waiting`;
  $("#waitlist-list").innerHTML = list.length
    ? list
        .map(
          (r) =>
            `<article class="client-row"><div class="client-person"><span class="avatar">${esc(initials(r.name))}</span><div><strong>${esc(r.name)}</strong><small>${esc(r.mobile)}</small></div></div><div><span>${esc(r.service)} · ${r.durationMinutes} min</span><small>${esc(r.stylist)}</small></div><div><span>${day(r.availableFrom)} · ${time(r.availableFrom)}–${time(r.availableUntil)}</span><small>${busy.has(r.clientId) ? "● Considering an offer" : "Waiting for the right opening"}</small>${r.existingAppointment ? `<small>Existing: ${esc(r.existingAppointment)}</small>` : ""}</div><div><button class="text-button destructive" data-action="remove-client" data-id="${esc(r.id)}">Remove</button></div></article>`,
        )
        .join("")
    : `<div class="empty-state"><h2>${search ? "No matching clients." : "Good appointments start with people."}</h2><p>${search ? "Try a different name, number, or service." : "Add the clients who would love an opening, along with the times that work for them."}</p>${!search ? '<button class="button primary" data-action="new-client">Add your first client</button>' : ""}</div>`;
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api("/api/salon");
    offset = data.serverNow - Date.now();
    state = data;
    $("#connection").hidden = true;
    const signature = JSON.stringify([data.requests, data.openings]);
    if (signature !== lastSignature) {
      lastSignature = signature;
      render();
    }
  } catch (error) {
    $("#connection").hidden = false;
    $("#connection").textContent =
      "Reconnecting to the salon. Updates may be delayed; your saved progress is retained. " +
      error.message;
  } finally {
    refreshing = false;
  }
}
function openForm(kind) {
  const form = $(`#${kind}-form`);
  form.reset();
  form.querySelector(".form-error").textContent = "";
  form.elements.date.value = dateKey();
  if (kind === "opening") {
    form.elements.date.min = dateKey();
    form.elements.date.max = dateKey();
    const latestStart = atPacific(dateKey(), "23:59") - 45 * 60_000;
    const suggestedStart = Math.max(
      Date.now() + 2 * 60_000,
      Math.min(Date.now() + 3600_000, latestStart),
    );
    form.elements.time.value = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(suggestedStart);
  } else {
    form.elements.date.min = dateKey();
  }
  $(`#${kind}-dialog`).showModal();
}
function confirmAction(title, message, buttonText) {
  return new Promise((resolve) => {
    const dialog = $("#confirm-dialog");
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    $("#confirm-button").textContent = buttonText;
    dialog.returnValue = "cancel";
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true },
    );
    dialog.showModal();
  });
}
async function addDemo() {
  if (
    !(await confirmAction(
      "A few familiar faces.",
      "Add six fictional clients available today. No real texts will be sent. Then create a Haircut opening with Jessica and select the 20-second demo option to watch the list move.",
      "Add demo clients",
    ))
  )
    return;
  const demo = [
    ["Maya Chen", "Haircut", "Jessica", 45],
    ["Olivia Brooks", "Haircut", "Any stylist", 45],
    ["Nora Patel", "Haircut", "Jessica", 45],
    ["Sofia Reyes", "Color", "Amara", 90],
    ["Emma Wilson", "Blowout", "Theo", 30],
    ["Ava Thompson", "Haircut", "Theo", 60],
  ];
  let added = 0;
  for (let i = 0; i < demo.length; i++) {
    const [name, service, stylist, durationMinutes] = demo[i];
    const mobile = `20255501${String(i + 10).padStart(2, "0")}`;
    if (
      state.requests.some((r) => r.mobile === mobile && r.status === "waiting")
    )
      continue;
    await api("/api/waitlist", {
      method: "POST",
      body: JSON.stringify({
        name,
        mobile,
        service,
        stylist,
        durationMinutes,
        availableFrom: atPacific(dateKey(), "00:00"),
        availableUntil: atPacific(dateKey(), "23:59"),
        existingAppointment:
          i === 0 ? "Staff to check existing booking in Square" : "",
      }),
    });
    added++;
  }
  await refresh();
  toast(
    `${added} fictional clients added. Create a haircut opening with Jessica to try the flow.`,
  );
  setView("waitlist");
}
document.addEventListener("click", async (event) => {
  const close = event.target.closest("[data-close]");
  if (close) {
    close.closest("dialog").close();
    return;
  }
  const nav = event.target.closest("[data-view]");
  if (nav) {
    setView(nav.dataset.view);
    return;
  }
  const card = event.target.closest("[data-opening]");
  if (card) {
    selectedId = card.dataset.opening;
    render();
    if (innerWidth < 681)
      $("#opening-detail").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "new-opening") return openForm("opening");
  if (action === "new-client") return openForm("client");
  button.disabled = true;
  try {
    if (action === "demo") {
      await addDemo();
      return;
    }
    const id = button.dataset.id;
    if (action === "remove-client") {
      if (
        !(await confirmAction(
          "Remove this request?",
          "Any current offer for this request will be withdrawn. The opening will move to the next eligible client.",
          "Remove request",
        ))
      )
        return;
      const result = await api(`/api/waitlist/${id}`, { method: "DELETE" });
      toast(result.message);
    } else {
      if (
        action === "cancel" &&
        !(await confirmAction(
          "Cancel this opening?",
          "Stop all outreach for this opening. The current offer can no longer be accepted, and the client page will explain the change.",
          "Cancel opening",
        ))
      )
        return;
      if (
        action === "next" &&
        !(await confirmAction(
          "Move to the next client?",
          "Withdraw only this offer. The client stays on the waitlist for other openings. The next eligible client will receive an offer.",
          "Withdraw & move on",
        ))
      )
        return;
      const result = await api(`/api/openings/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ offerId: button.dataset.offer }),
      });
      toast(result.message);
    }
    await refresh();
  } catch (error) {
    toast(error.message, true);
    await refresh();
  } finally {
    button.disabled = false;
  }
});
$("#opening-filter").addEventListener("change", render);
$("#client-search").addEventListener("input", renderWaitlist);
for (const kind of ["opening", "client"]) {
  const form = $(`#${kind}-form`);
  form.elements.service.addEventListener(
    "change",
    () =>
      (form.elements.durationMinutes.value = {
        Haircut: "45",
        Color: "90",
        Blowout: "30",
      }[form.elements.service.value]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    const errorEl = form.querySelector(".form-error");
    errorEl.textContent = "";
    try {
      const values = Object.fromEntries(new FormData(form));
      const body = {
        ...values,
        durationMinutes: Number(values.durationMinutes),
      };
      if (kind === "opening")
        Object.assign(body, {
          startsAt: atPacific(values.date, values.time),
          reservedInSquare: form.elements.reservedInSquare.checked,
          demo: form.elements.demo.checked,
        });
      else
        Object.assign(body, {
          availableFrom: atPacific(values.date, values.from),
          availableUntil: atPacific(values.date, values.until),
        });
      const result = await api(
        kind === "opening" ? "/api/openings" : "/api/waitlist",
        { method: "POST", body: JSON.stringify(body) },
      );
      if (kind === "opening") {
        selectedId = result.id;
        setView("openings");
      }
      $(`#${kind}-dialog`).close();
      await refresh();
      toast(result.message);
    } catch (error) {
      errorEl.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}
$("#today").textContent =
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(Date.now())
    .toUpperCase() + " · YOUR SALON, IN SYNC";
render();
refresh();
setInterval(refresh, 1800);
setInterval(updateClocks, 500);
