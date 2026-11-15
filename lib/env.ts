import { z } from "zod";

/**
 * Server-only environment validation. Errors name the missing variable but never
 * print its value. See hotel-saas-documentation/08-deployment/ENVIRONMENT_VARIABLES.md.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DIRECT_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.url(),
});

export type ServerEnv = z.infer<typeof schema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment configuration:\n${problems}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
