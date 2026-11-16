import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";

/**
 * Runs a page's data loader and turns a service "not found" (including another tenant's
 * ids) into the framework 404, instead of an error logged for every probe.
 */
export async function loadOr404<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  }
}
