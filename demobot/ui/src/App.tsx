import React, { useState, useRef, useEffect, useCallback } from "react";
import { askBot } from "./api";
import { ChatMessage, SalesbotResult } from "./types";
import ChatArea from "./components/ChatArea";
import AdminPanel from "./components/AdminPanel";

function makeId() {
  return Math.random().toString(36).slice(2);
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selected, setSelected] = useState<SalesbotResult | null>(null);
  const [loading, setLoading] = useState(false);

  const updateMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
      );
    },
    []
  );

  const send = useCallback(
    async (query: string) => {
      if (!query.trim() || loading) return;

      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        text: query,
        ts: Date.now(),
      };

      const botId = makeId();
      const botMsg: ChatMessage = {
        id: botId,
        role: "bot",
        text: "",
        loading: true,
        ts: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, botMsg]);
      setLoading(true);
      // Do NOT auto-select — panel only opens via "Inspect workflow →" click
      setSelected(null);

      try {
        const result = await askBot(query);
        updateMessage(botId, {
          text: result.ok ? result.answer : `Error: ${result.error ?? "Unknown error"}`,
          result,
          loading: false,
        });
        // Do not call setSelected(result) here — user must click to inspect
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateMessage(botId, { text: `Request failed: ${msg}`, loading: false });
      } finally {
        setLoading(false);
      }
    },
    [loading, updateMessage]
  );

  const handleSelectMessage = useCallback((result: SalesbotResult) => {
    setSelected(result);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">⬡</span>
          <span className="brand-title">SAP Salesbot</span>
          <span className="brand-sub">Workflow Demo</span>
        </div>
        <div className="header-actions">
          <button 
            className="inspect-global-btn" 
            onClick={() => {
              const latestResult = messages.slice().reverse().find(m => m.role === "bot" && m.result)?.result;
              if (latestResult) setSelected(latestResult);
            }}
            disabled={!messages.some(m => m.role === "bot" && m.result)}
          >
            Inspect Latest Workflow
          </button>
        </div>
      </header>

      <main className={`app-main ${selected ? "app-main--panel-open" : ""}`}>
        <section className="chat-section">
          <ChatArea
            messages={messages}
            loading={loading}
            onSend={send}
            onSelectMessage={handleSelectMessage}
          />
        </section>

        {selected && (
          <aside className="admin-section">
            <AdminPanel result={selected} onClose={() => setSelected(null)} />
          </aside>
        )}
      </main>
    </div>
  );
}
