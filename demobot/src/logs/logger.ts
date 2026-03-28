// Minimal timestamped logger – no external dependencies
// Replace with pino / winston later if needed.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function timestamp(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.` +
    `${pad(d.getMilliseconds(), 3)}Z`
  );
}

function format(level: LogLevel, namespace: string, msg: string, meta?: unknown): string {
  const metaPart = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] [${namespace}] ${msg}${metaPart}`;
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export function createLogger(namespace: string): Logger {
  return {
    debug(msg, meta) {
      if (shouldLog("debug")) console.debug(format("debug", namespace, msg, meta));
    },
    info(msg, meta) {
      if (shouldLog("info")) console.info(format("info", namespace, msg, meta));
    },
    warn(msg, meta) {
      if (shouldLog("warn")) console.warn(format("warn", namespace, msg, meta));
    },
    error(msg, meta) {
      if (shouldLog("error")) console.error(format("error", namespace, msg, meta));
    },
  };
}

// Convenience root logger
export const logger: Logger = createLogger("app");
