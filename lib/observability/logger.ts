/**
 * Minimal structured JSON logger. Secret-looking keys are always redacted so
 * passwords, tokens and keys never reach log storage. Swap the sink for Sentry/
 * a log drain in the deployment phase.
 */
const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|hash|card|cvv|otp/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1),
    ]),
  );
}

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...(redact(fields ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => process.env.NODE_ENV !== "production" && emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};

export function errorFields(err: unknown): Record<string, unknown> {
  return err instanceof Error ? { errorName: err.name, errorMessage: err.message } : { error: String(err) };
}
