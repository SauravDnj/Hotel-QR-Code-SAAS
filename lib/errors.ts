/** Errors whose message is safe to show to the signed-in user. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "forbidden" | "not_found" | "conflict" | "validation" | "rate_limited" | "tenant_inactive" | "plan_limit",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "You do not have permission to do that.") =>
  new AppError(msg, "forbidden");

// Used for cross-tenant lookups too, so other tenants' records are indistinguishable
// from records that do not exist.
export const notFound = (msg = "Not found.") => new AppError(msg, "not_found");

export const conflict = (msg: string) => new AppError(msg, "conflict");

export const rateLimited = () =>
  new AppError("Too many attempts from this network. Please try again later.", "rate_limited");
