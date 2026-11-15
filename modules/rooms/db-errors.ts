/** Postgres error codes, read through driver/drizzle wrappers (error.cause chain). */
function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgCode(err) === "23505";
export const isForeignKeyViolation = (err: unknown) => pgCode(err) === "23503";
