import { NativeConnection, Worker } from "@temporalio/worker";

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  });
  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: process.env.SALON_TASK_QUEUE ?? "juniper-salon",
    workflowsPath: require.resolve("./workflows"),
  });
  console.log("Juniper's waitlist worker is ready.");
  try {
    await worker.run();
  } finally {
    await connection.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
