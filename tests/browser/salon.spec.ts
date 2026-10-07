import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("staff and mobile client: decline, accept, Square follow-up, and stale link", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good things fill the gaps." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add fictional clients for a demo" })
    .click();
  await page
    .getByRole("button", { name: "Add demo clients", exact: true })
    .click();
  await expect(page.getByText("6 client requests waiting")).toBeVisible();
  await page.getByRole("button", { name: /^Openings/ }).click();
  await page.getByRole("button", { name: "New opening", exact: false }).click();
  const dialog = page.locator("#opening-dialog");
  await dialog.getByLabel("I've checked and reserved").check();
  await dialog.getByRole("button", { name: "Start offering" }).click();
  await expect(page.locator(".offer-person strong")).toHaveText("Maya Chen");
  mkdirSync("evidence", { recursive: true });
  await page.screenshot({ path: "evidence/staff-desktop.png", fullPage: true });

  const firstLink = await page
    .getByRole("link", { name: "Open client offer" })
    .getAttribute("href");
  const client = await context.newPage();
  await client.setViewportSize({ width: 390, height: 844 });
  await client.goto(firstLink!);
  await expect(
    client.getByRole("heading", { name: /A moment for you/ }),
  ).toBeVisible();
  await client.screenshot({
    path: "evidence/client-mobile.png",
    fullPage: true,
  });
  expect(
    await client.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await client.getByRole("button", { name: "Not this time" }).click();
  await expect(
    client.getByRole("heading", { name: "We'll keep you in mind." }),
  ).toBeVisible();
  await expect(page.locator(".offer-person strong")).toHaveText(
    "Olivia Brooks",
  );
  const nextLink = await page
    .getByRole("link", { name: "Open client offer" })
    .getAttribute("href");
  await client.goto(nextLink!);
  await client
    .getByRole("button", { name: "Yes, I'd love this appointment" })
    .click();
  await expect(
    client.getByRole("heading", { name: "It's yours, Olivia." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Square update pending" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I've updated Square" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Square calendar updated",
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    client.getByText("The salon has finished updating its calendar."),
  ).toBeVisible();
  const stale = await page.request.post(
    `/api/offers/${new URL(firstLink!, "http://localhost").searchParams.get("token")}`,
    { data: { response: "accept" } },
  );
  expect(stale.status()).toBe(409);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "evidence/staff-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Waitlist", exact: true }).click();
  await expect(page.getByText("5 client requests waiting")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile staff form, automatic timeout, and cancellation invalidate offer links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New opening", exact: false }).click();
  const dialog = page.locator("#opening-dialog");
  await dialog
    .getByRole("combobox", { name: "Stylist", exact: true })
    .selectOption("Theo");
  await dialog
    .getByRole("combobox", { name: "Opening length" })
    .selectOption("60");
  // Use a short service duration so this remains valid close to midnight.
  await dialog
    .getByRole("combobox", { name: "Opening length" })
    .selectOption("30");
  await dialog
    .getByRole("combobox", { name: "Service", exact: true })
    .selectOption("Blowout");
  await dialog.getByLabel("I've checked and reserved").check();
  await dialog.getByLabel("Use 20-second offers").check();
  await dialog.getByRole("button", { name: "Start offering" }).click();
  await expect(page.locator(".offer-person strong")).toHaveText("Emma Wilson");
  const offerLink = await page
    .getByRole("link", { name: "Open client offer" })
    .getAttribute("href");
  await expect(
    page.getByRole("heading", { name: "Outreach has ended." }),
  ).toBeVisible({ timeout: 30_000 });
  const token = new URL(offerLink!, "http://localhost").searchParams.get(
    "token",
  );
  expect(
    (
      await page.request.post(`/api/offers/${token}`, {
        data: { response: "accept" },
      })
    ).status(),
  ).toBe(409);
  await page.getByRole("button", { name: "New opening", exact: false }).click();
  await dialog
    .getByRole("combobox", { name: "Service", exact: true })
    .selectOption("Blowout");
  await dialog
    .getByRole("combobox", { name: "Stylist", exact: true })
    .selectOption("Theo");
  await dialog.getByLabel("I've checked and reserved").check();
  await dialog.getByRole("button", { name: "Start offering" }).click();
  await expect(page.locator(".offer-person strong")).toHaveText("Emma Wilson");
  const cancelLink = await page
    .getByRole("link", { name: "Open client offer" })
    .getAttribute("href");
  await page
    .getByRole("button", { name: "Cancel opening", exact: true })
    .click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "Cancel opening", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "This opening has been cancelled." }),
  ).toBeVisible();
  await page.goto(cancelLink!);
  await expect(
    page.getByText("We're sorry for the change.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Yes, I'd love/ })).toHaveCount(
    0,
  );
});
