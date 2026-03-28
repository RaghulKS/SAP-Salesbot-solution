import { SalesbotResult } from "./types";

const BASE = "";

// ── /ask ─────────────────────────────────────────────────────────────────────

export async function askBot(query: string): Promise<SalesbotResult> {
  const res = await fetch(`${BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<SalesbotResult>;
}

// ── /stt ─────────────────────────────────────────────────────────────────────
// Send a recorded audio Blob to the server and get back a transcript string.

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "recording.webm");

  const res = await fetch(`${BASE}/stt`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `STT HTTP ${res.status}`);
  }

  const data = (await res.json()) as { transcript: string };
  return data.transcript;
}

