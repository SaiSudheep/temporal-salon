import { chromium } from "@playwright/test";
import { Client, Connection } from "@temporalio/client";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("evidence", { recursive: true });
const connection = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection });
let execution;
for await (const item of client.workflow.list({
  query: 'WorkflowType = "salonWorkflow"',
})) {
  if (item.workflowId.startsWith("juniper-browser-")) {
    const state = await client.workflow
      .getHandle(item.workflowId)
      .query("getSalon");
    if (
      state.openings.some((o) =>
        o.offers.some((f) => f.status === "expired"),
      ) &&
      state.openings.some((o) => o.status === "filled")
    ) {
      execution = item;
      break;
    }
  }
}
if (!execution)
  throw new Error(
    "Run npm run test:ui successfully before capturing evidence.",
  );
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1150 },
  });
  const url = `http://localhost:8233/namespaces/default/workflows/${encodeURIComponent(execution.workflowId)}/${execution.runId}/history`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .getByText(execution.workflowId, { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  await page.screenshot({
    path: "evidence/temporal-history.png",
    fullPage: true,
  });
  writeFileSync(
    "evidence/workflow.json",
    JSON.stringify(
      {
        workflowId: execution.workflowId,
        runId: execution.runId,
        url,
        note: "Single-salon coordinator remains Running. Individual openings have filled, expired, or cancelled outcomes in its state.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      workflowId: execution.workflowId,
      screenshot: "evidence/temporal-history.png",
    }),
  );
} finally {
  await browser.close();
  await connection.close();
}
