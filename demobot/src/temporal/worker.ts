// src/temporal/worker.ts
// Temporal worker – connects to the server and polls the task queue.
// Run with: npm run worker

import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { config } from "../config";
import { createLogger } from "../logs/logger";

const log = createLogger("temporal:worker");

async function run(): Promise<void> {
  log.info("Connecting to Temporal server", { address: config.TEMPORAL_ADDRESS });

  const connection = await NativeConnection.connect({
    address: config.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    // Temporal bundles the workflow file separately into a sandbox.
    // require.resolve gives the bundler the correct absolute entry point.
    workflowsPath: require.resolve("./workflows"),
    activities,
  });

  log.info("Worker started – polling for tasks", {
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    namespace: config.TEMPORAL_NAMESPACE,
  });

  await worker.run();
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error("Worker crashed", { error: msg });
  process.exit(1);
});
