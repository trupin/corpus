// SPEC.md §9.4's cost ledger: what using this workspace costs, kept as runtime
// state beside the queue — never a document, never committed, absent after a
// rebuild and none the worse for it.

export { recordInvocations } from "./record.js";
export { documentCost, BUCKET_MS, COST_GRANULARITY } from "./series.js";
export {
  pruneTelemetry,
  startTelemetryRetention,
  TELEMETRY_PRUNE_INTERVAL_MS,
  TELEMETRY_RETENTION_DAYS,
  TELEMETRY_RETENTION_MS,
  type TelemetryRetentionDeps,
} from "./retention.js";
export { mountTelemetryRoutes, type TelemetryRoutesOptions } from "./routes.js";
