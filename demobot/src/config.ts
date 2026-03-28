import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// ---------------------------------------------------------------------------
// Schema – each field is validated at startup so the app fails fast on bad config
// ---------------------------------------------------------------------------
const ConfigSchema = z.object({
  // Temporal
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("salesbot-queue"),

  // Express
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  ALLOWED_ORIGIN: z.string().url().default("http://localhost:5173"),
  MAX_QUERY_LENGTH: z.coerce.number().int().min(64).max(10000).default(2048),
  API_AUTH_TOKEN: z.string().min(24).optional(),

  // LLM providers
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),

  // MCP
  MCP_SERVER_URL: z.string().url().optional(),
  /** When true, skip live MCP calls and query Supabase as the demo backend */
  USE_MOCK_SAP: z
    .string()
    .transform((v) => v.toLowerCase() === "true")
    .default("false"),

  // Supabase (required when USE_MOCK_SAP=true)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_READONLY_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "production" && !value.API_AUTH_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["API_AUTH_TOKEN"],
      message: "API_AUTH_TOKEN is required in production",
    });
  }

  if (
    value.USE_MOCK_SAP &&
    (!value.SUPABASE_URL || (!value.SUPABASE_READONLY_KEY && !value.SUPABASE_SERVICE_ROLE_KEY))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SUPABASE_URL"],
      message: "SUPABASE_URL and either SUPABASE_READONLY_KEY or SUPABASE_SERVICE_ROLE_KEY are required when USE_MOCK_SAP=true",
    });
  }

  if (
    value.NODE_ENV === "production" &&
    value.USE_MOCK_SAP &&
    !value.SUPABASE_READONLY_KEY
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SUPABASE_READONLY_KEY"],
      message: "SUPABASE_READONLY_KEY is required in production when USE_MOCK_SAP=true",
    });
  }
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌  Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config: Config = loadConfig();
