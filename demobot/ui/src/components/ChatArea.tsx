// ui/src/components/ChatArea.tsx
//
// Chat panel with:
//   - Message list + typing indicator
//   - Mic (STT) button in the input row
//   - Per-message speaker (TTS) button on every bot reply
//   - Suggestion chips for the empty state
//
// Speech integration points:
//   - useMic: captures audio, sends to /stt, puts transcript in the input box
//   - useMic: captures audio, sends to /stt, puts transcript in the input box
//
// The existing send path is completely unchanged.
// Transcribed text enters via setInput() and is sent via the normal onSend().

import React, { useEffect, useRef, useState, KeyboardEvent, useCallback } from "react";
import { ChatMessage, SalesbotResult } from "../types";
import { useMic } from "../hooks/useMic";

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (q: string) => void;
  onSelectMessage: (result: SalesbotResult) => void;
}

const SUGGESTIONS = [
  "What is the status of order 100021935?",
  "What is the total for order 100021935?",
  "Show the last 5 orders for customer 17100001",
];

// ── Main ChatArea ─────────────────────────────────────────────────────────────

export default function ChatArea({ messages, loading, onSend, onSelectMessage }: Props) {
  const [input, setInput] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef(""); // Stores input typed *before* mic was clicked

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    baseInputRef.current = "";
    setSttError(null);
    onSend(q);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── STT: real-time streaming updates from browser ──────────────────────────

  const handleTranscript = useCallback((text: string) => {
    const newText = baseInputRef.current
      ? baseInputRef.current + " " + text.trim()
      : text.trim();
    setInput(newText);
    inputRef.current?.focus();
  }, []);

  const { recording, error: micError, supported: micSupported, startRecording, stopRecording } =
    useMic(handleTranscript);

  const handleMicClick = () => {
    if (recording) {
      stopRecording();
    } else {
      baseInputRef.current = input.trim(); // Save what user already typed
      startRecording();
    }
  };

  const micBusy = recording;
  const micTitle = !micSupported
    ? "Microphone not supported in this browser"
    : recording
    ? "Click to stop recording"
    : "Click to speak your query";

  // Combined error shown below the input row
  const speechError = sttError ?? micError;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Chat</span>
        {messages.length === 0 && (
          <span className="chat-hint">Ask about SAP sales orders</span>
        )}
      </div>

      <div className="message-list">
        {messages.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">Workflow-driven SAP Sales Chatbot</p>
            <p className="empty-sub">
              Every response runs a full Temporal workflow. The panel on the
              right shows each execution step in real time.
            </p>
            <div className="suggestion-chips">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="chip"
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`message message--${m.role}`}>
            <div className="message-bubble">
              {m.loading ? (
                <span className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <>
                  <p className="message-text">{m.text}</p>

                  {/* ── Bot message footer ──────────────────────────────── */}
                  {m.role === "bot" && (
                    <div className="message-footer">
                      {/* Workflow metadata tags */}
                      {m.result && (
                        <div className="message-meta">
                          <span className="meta-tag">
                            {m.result.trace.steps.join(" → ")}
                          </span>
                          <span className="meta-tag meta-tag--muted">
                            {m.result.trace.durationMs}ms
                          </span>
                          {m.result.usedFallback && (
                            <span className="meta-tag meta-tag--warn">fallback</span>
                          )}
                          {m.result.trace.mockMode && (
                            <span className="meta-tag meta-tag--mock">mock</span>
                          )}
                        </div>
                      )}


                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input row ──────────────────────────────────────────────────────── */}

      {speechError && (
        <div className="speech-error-banner">
          {speechError}
        </div>
      )}

      <div className="chat-input-row">
        {/* STT mic button */}
        <button
          id="mic-btn"
          className={`icon-btn mic-btn ${recording ? "mic-btn--recording" : ""}`}
          onClick={handleMicClick}
          disabled={!micSupported || loading}
          title={micTitle}
          aria-label={micTitle}
        >
          {recording ? "⏺" : "🎙"}
        </button>

        <input
          ref={inputRef}
          id="chat-input"
          className="chat-input"
          type="text"
          placeholder={
            recording
              ? "Listening… click mic to stop"
              : "Ask about an order or customer…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
        />

        <button
          id="send-btn"
          className="send-btn"
          onClick={handleSend}
          disabled={loading || micBusy || !input.trim()}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
