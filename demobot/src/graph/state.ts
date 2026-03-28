// src/graph/state.ts
//
// LangGraph state definition using Annotation.Root.
// Each key maps to a channel in the StateGraph.

import { Annotation } from "@langchain/langgraph";
import type { SalesIntent, SalesPlan } from "./types";

// ---------------------------------------------------------------------------
// PlannerState – the full state carried through every graph node
// ---------------------------------------------------------------------------

export const PlannerState = Annotation.Root({
  /** Original natural-language query from the user */
  userQuery: Annotation<string>,

  /** Classified intent (null until classifyIntent runs) */
  intent: Annotation<SalesIntent | null>,

  /** IDs extracted from the query by the LLM */
  extractedIds: Annotation<Record<string, string>>,

  /** The assembled plan (null until buildPlan runs) */
  plan: Annotation<SalesPlan | null>,

  /** Validation / classification error message (null = no error) */
  error: Annotation<string | null>,
});

/** TypeScript type inferred from the annotation */
export type PlannerStateType = typeof PlannerState.State;
