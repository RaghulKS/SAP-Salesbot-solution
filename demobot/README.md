# Salesbot Demo

Salesbot Demo is a full-stack TypeScript project that answers SAP sales order questions through a chat UI.

## What this project does

- Accepts user questions from a React frontend.
- Classifies user intent with a planner graph.
- Queries backend data through an MCP integration or Supabase mock mode.
- Runs orchestration through Temporal workflows.
- Returns a business-friendly response to the UI.
- Supports speech-to-text input through Google Cloud Speech-to-Text.

## Tech stack

- Backend: Node.js, Express, TypeScript
- Workflow orchestration: Temporal
- LLM orchestration: LangGraph and LangChain
- Speech: Google Cloud Speech-to-Text
- Data integration: MCP and Supabase
- Frontend: React and Vite

## Project structure

- src/: Backend source
- src/server.ts: Main HTTP server
- src/speech.ts: Speech route handlers
- src/temporal/: Workflows and activities
- src/graph/: Planning graph and prompt logic
- src/mcp/: MCP and Supabase integration layer
- src/sales/: Data normalization and answer generation
- ui/: React frontend source
- dist-ui/: Frontend build output (generated)

## HTTP API

- GET /health
  - Returns service status and mode information.
- POST /ask
  - Input: JSON with query and optional sessionId.
  - Behavior: Starts a Temporal workflow and returns the computed answer.
- POST /stt
  - Input: multipart/form-data with audio field.
  - Behavior: Returns transcript text from Google STT.

## Security model

Current server protections include:

- Token-based API protection for /ask and /stt when API_AUTH_TOKEN is set.
- Request rate limiting for /ask and /stt.
- Request body size limit for JSON payloads.
- CORS allowlist with ALLOWED_ORIGIN and controlled localhost fallback in non-production.
- Production requirement for API_AUTH_TOKEN through startup validation.
- Health response no longer exposes Temporal endpoint internals.
- Sanitized production error responses.

## Environment variables

Copy .env.example to .env and set values:

- GEMINI_API_KEY
- API_AUTH_TOKEN
- ALLOWED_ORIGIN
- MAX_QUERY_LENGTH
- MCP_SERVER_URL
- USE_MOCK_SAP
- SUPABASE_URL
- SUPABASE_READONLY_KEY
- SUPABASE_SERVICE_ROLE_KEY
- GOOGLE_APPLICATION_CREDENTIALS
- GOOGLE_CLOUD_PROJECT
- TEMPORAL_ADDRESS (optional, default localhost:7233)
- TEMPORAL_NAMESPACE (optional, default default)
- TEMPORAL_TASK_QUEUE (optional, default salesbot-queue)
- PORT (optional, default 3000)
- NODE_ENV (development, test, production)

## Local development

1. Install dependencies:
   - npm ci
2. Set environment values:
   - copy .env.example .env
3. Start backend server:
   - npm run server
4. Start Temporal worker:
   - npm run worker
5. Start frontend dev server:
   - npm run ui

## Uploading to GitHub

This repository is configured to avoid committing local-only or generated files.

Ignored by default:

- .env and local env files
- node_modules/
- dist, dist-ui, ui/dist
- env and other local virtual environment folders
- log and editor artifacts

## Recommended pre-push checks

1. npm ci
2. npm run server
3. npm run worker
4. npm run ui
5. Verify /health and /ask behavior locally
6. Confirm no real secrets are present in tracked files

## Notes

- Prefer SUPABASE_READONLY_KEY with row-level security in production.
- Keep API_AUTH_TOKEN rotated and stored in a secret manager for hosted environments.
- Treat MCP endpoint configuration as sensitive runtime configuration.
