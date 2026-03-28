// src/speech.ts
//
// Express router providing two speech endpoints:
//
//   POST /stt  – receive audio blob, return { transcript: string }
//
// Design constraints:
//   - These routes are pure UI helpers. They do NOT touch the Temporal
//     workflow, the LangGraph planner, the MCP client, or any SAP layer.
//   - STT produces a text string; the browser then puts that string into the
//     chat input and the user presses Send — sending it through the normal
//     /ask → salesbotWorkflow path.

import { Router, Request, Response } from "express";
import multer from "multer";
import { SpeechClient } from "@google-cloud/speech";
import { createLogger } from "./logs/logger";
import { createAuthMiddleware, createRateLimiter } from "./httpSecurity";
import { config } from "./config";

const log = createLogger("speech");

// ---------------------------------------------------------------------------
// Clients (lazy singletons — created on first request to avoid startup errors
// when credentials are not yet configured)
// ---------------------------------------------------------------------------

let _sttClient: SpeechClient | null = null;

function getSttClient(): SpeechClient {
  if (!_sttClient) _sttClient = new SpeechClient();
  return _sttClient;
}

// ---------------------------------------------------------------------------
// multer — keeps audio in memory, capped at 10 MB
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const speechRouter = Router();
const requireApiAuth = createAuthMiddleware(config.API_AUTH_TOKEN);
const sttRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

// ── POST /stt ────────────────────────────────────────────────────────────────
//
// Accepts: multipart/form-data with field "audio" (WebM/OGG/WAV blob)
// Returns: { transcript: string } or { error: string }

speechRouter.post(
  "/stt",
  requireApiAuth,
  sttRateLimit,
  upload.single("audio"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No audio file received" });
      return;
    }

    log.info("POST /stt", {
      mimetype: req.file.mimetype,
      bytes: req.file.size,
    });

    try {
      const client = getSttClient();

      // Chrome/Edge MediaRecorder defaults to audio/webm;codecs=opus
      // We tell Google the encoding explicitly so it handles it without
      // needing to convert client-side.
      const [response] = await client.recognize({
        audio: { content: req.file.buffer.toString("base64") },
        config: {
          encoding: "WEBM_OPUS",
          sampleRateHertz: 48000,
          languageCode: "en-US",
          model: "latest_short",
          // Hint the model toward SAP sales domain vocabulary
          speechContexts: [
            {
              phrases: [
                "sales order",
                "order status",
                "order total",
                "customer",
                "what is the status",
                "what is the total",
                "show the last",
                "recent orders",
              ],
              boost: 10,
            },
          ],
        },
      });

      const transcript =
        response.results
          ?.map((r) => r.alternatives?.[0]?.transcript ?? "")
          .join(" ")
          .trim() ?? "";

      log.info("STT result", { transcriptLength: transcript.length });
      res.json({ transcript });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("STT error", { error: msg });
      const safeError = config.NODE_ENV === "development"
        ? `Speech recognition failed: ${msg}`
        : "Speech recognition failed";
      res.status(500).json({ error: safeError });
    }
  }
);

