// src/temporal/client.ts
// Temporal client – starts salesbotWorkflow and prints the result.
// Run with: npm run client
//
// Usage:
//   npm run client -- "What is the status of order 1234?"
//   npm run client -- "Show recent orders for customer 1000" --session my-session-id

import { Connection, WorkflowClient } from "@temporalio/client";
import { salesbotWorkflow } from "./workflows";
import type { SalesbotInput, SalesbotResult } from "./types";
import { config } from "../config";
import { createLogger } from "../logs/logger";

const log = createLogger("temporal:client");

function parseArgs(): SalesbotInput {
  const args = process.argv.slice(2);
  const sessionFlagIdx = args.indexOf("--session");

  let sessionId: string | undefined;
  let queryArgs = args;

  if (sessionFlagIdx !== -1) {
    sessionId = args[sessionFlagIdx + 1];
    queryArgs = args.filter((_, i) => i !== sessionFlagIdx && i !== sessionFlagIdx + 1);
  }

  const userQuery = queryArgs.join(" ") || "What is the status of order 1000?";
  return { userQuery, sessionId };
}

async function run(): Promise<void> {
  const input = parseArgs();

  log.info("Connecting to Temporal", { address: config.TEMPORAL_ADDRESS });

  const connection = await Connection.connect({
    address: config.TEMPORAL_ADDRESS,
  });

  const client = new WorkflowClient({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
  });

  log.info("Starting salesbotWorkflow", { input });

  const handle = await client.start(salesbotWorkflow, {
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    // Timestamp suffix prevents ID collisions across runs
    workflowId: `salesbot-${Date.now()}`,
    args: [input],
  });

  log.info("Workflow started", { workflowId: handle.workflowId });

  const result: SalesbotResult = await handle.result();

  // Pretty-print the full result
  console.log("\n══════════════════════════════════════");
  console.log("  Salesbot Result");
  console.log("══════════════════════════════════════");
  console.log(`  Query   : ${result.query}`);
  console.log(`  OK      : ${result.ok}`);
  console.log(`  Intent  : ${result.plan?.intent ?? "—"}`);
  console.log(`  Smart Q : ${result.usedSmartQuery}`);
  console.log(`  Fallback: ${result.usedFallback}`);
  if (result.error) console.log(`  Error   : ${result.error}`);
  console.log("──────────────────────────────────────");
  console.log("  Answer:");
  console.log(result.answer ? `  ${result.answer}` : "  (no answer)");
  console.log("──────────────────────────────────────");
  console.log("  Execution Trace:");
  console.log(`  Workflow : ${result.trace.workflowId}`);
  console.log(`  Duration : ${result.trace.durationMs}ms`);
  console.log(`  Steps    : ${result.trace.steps.join(" → ")}`);
  console.log(`  Mock     : ${result.trace.mockMode}`);
  console.log("══════════════════════════════════════\n");

  if (!result.ok) process.exit(1);
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error("Client error", { error: msg });
  process.exit(1);
});
