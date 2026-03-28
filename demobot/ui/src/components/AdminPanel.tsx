import React from "react";
import { SalesbotResult } from "../types";

interface Props {
  result: SalesbotResult | null;
  onClose?: () => void;
}

const STEP_LABELS: Record<string, string> = {
  plan: "1. LangGraph Planner",
  auth: "2. SAP Authentication",
  smartQuery: "3. SAP Smart Query",
  fallback: "4. Deterministic Fallback",
  normalize: "5. Extraction + Normalization",
  answer: "6. Final Answer Generator",
};

function StepRow({ name, steps }: { name: string; steps: string[] }) {
  const ran = steps.includes(name);
  return (
    <div className={`step-row ${ran ? "step-row--ran" : "step-row--skipped"}`}>
      <span className="step-dot">{ran ? "✓" : "–"}</span>
      <span className="step-label">{STEP_LABELS[name] ?? name}</span>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="json-block">
      <p className="json-label">{label}</p>
      <pre className="json-pre">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`info-row ${highlight ? "info-row--highlight" : ""}`}>
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

export default function AdminPanel({ result, onClose }: Props) {
  if (!result) {
    return (
      <div className="admin-panel admin-panel--empty">
        <div className="admin-header">
          <span className="admin-title">Workflow Inspector</span>
        </div>
        <div className="admin-empty">
          <p>Send a query to see live workflow state.</p>
          <p className="admin-empty-sub">
            This panel shows the actual Temporal activity execution, LangGraph
            plan, extracted data, and normalized model for each request.
          </p>
        </div>
      </div>
    );
  }

  const { trace, plan, model, usedSmartQuery, usedFallback, ok, error, query } = result;

  const allSteps = ["plan", "auth", "smartQuery", "fallback", "normalize", "answer"];

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <span className="admin-title">Workflow Inspector</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className={`status-badge ${ok ? "status-badge--ok" : "status-badge--err"}`}>
            {ok ? "SUCCESS" : "FAILED"}
          </span>
          {onClose && (
            <button className="panel-close-btn" onClick={onClose} aria-label="Close panel" title="Close">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Identity ── */}
      <section className="admin-section-block">
        <h3 className="section-heading">Request</h3>
        <Row label="User Query" value={<em>{query}</em>} />
        <Row label="Workflow ID" value={<code>{trace.workflowId}</code>} />
        <Row label="Mode" value={trace.mockMode ? "🟡 Mock SAP" : "🟢 Live SAP"} highlight />
        <Row label="Duration" value={`${trace.durationMs} ms`} />
        <Row label="Started" value={new Date(trace.startedAt).toLocaleTimeString()} />
        <Row label="Completed" value={new Date(trace.completedAt).toLocaleTimeString()} />
        {error && <Row label="Error" value={<span className="error-text">{error}</span>} />}
      </section>

      {/* ── Execution Steps ── */}
      <section className="admin-section-block">
        <h3 className="section-heading">Execution Steps</h3>
        <div className="step-list">
          {allSteps.map((s) => (
            <StepRow key={s} name={s} steps={trace.steps} />
          ))}
        </div>
        <div className="step-summary">
          <span className={`tag ${usedSmartQuery ? "tag--green" : "tag--grey"}`}>
            smart-query {usedSmartQuery ? "✓" : "–"}
          </span>
          <span className={`tag ${usedFallback ? "tag--yellow" : "tag--grey"}`}>
            fallback {usedFallback ? "✓" : "–"}
          </span>
        </div>
      </section>

      {/* ── LangGraph Plan ── */}
      {plan && (
        <section className="admin-section-block">
          <h3 className="section-heading">LangGraph Plan</h3>
          <Row label="Intent" value={<code>{plan.intent}</code>} highlight />
          <Row label="Strategy" value={<code>{plan.strategy}</code>} />
          <Row label="Fallback" value={<code>{plan.fallback}</code>} />
          <Row
            label="Confidence"
            value={
              <span className="confidence-bar">
                <span
                  className="confidence-fill"
                  style={{ width: `${Math.round(plan.confidence * 100)}%` }}
                />
                <span className="confidence-pct">{Math.round(plan.confidence * 100)}%</span>
              </span>
            }
          />
          <JsonBlock label="Extracted IDs" value={plan.extractedIds} />
        </section>
      )}

      {/* ── Normalized Model ── */}
      {model && (
        <section className="admin-section-block">
          <h3 className="section-heading">Normalized Model</h3>
          <Row label="Model Type" value={<code>{model.intent}</code>} highlight />
          <JsonBlock label="Full Model" value={model} />
        </section>
      )}

      {/* ── Raw Trace ── */}
      <section className="admin-section-block">
        <h3 className="section-heading">Raw Trace</h3>
        <JsonBlock label="trace.steps executed" value={trace.steps} />
      </section>
    </div>
  );
}
