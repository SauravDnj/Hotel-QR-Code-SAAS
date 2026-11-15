# Technology Stack

## Recommended stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript | Shared types and validation |
| Web framework | Next.js App Router | Guest, staff, admin and API |
| UI | Tailwind CSS + shadcn/ui | Consistent accessible components |
| Forms | React Hook Form + Zod | Client UX plus server validation |
| Database | PostgreSQL on Neon | Managed external database |
| ORM | Prisma or Drizzle | Pick one and standardize |
| Authentication | Auth.js or managed auth provider | Staff/admin identity |
| Authorization | Application RBAC + scoped queries | Tenant/property/department |
| Realtime | Ably or Pusher | Authenticated channels |
| File storage | Vercel Blob | Logos and exports; protect private files |
| Payments | Razorpay | Plans/subscriptions; webhook verification |
| Monitoring | Sentry + structured logs | Error and latency monitoring |
| Testing | Vitest, Playwright | Unit, integration and browser tests |
| Hosting | Vercel | Production and preview environments |

## Important Vercel clarification

Vercel is the deployment platform for the web application and compatible functions. It does not mean the PostgreSQL database is physically hosted inside the Vercel application runtime. Connect a managed database such as Neon through the Vercel Marketplace or secure environment variables.

## Database connection strategy

- Use the provider's pooled connection string for serverless runtime.
- Use a direct connection string for migration commands when the provider recommends it.
- Never expose database URLs to browser bundles.
- Keep pool sizes and connection limits appropriate for serverless concurrency.
- Avoid opening a new unmanaged connection per request.
- Run migrations as a controlled deployment step, not concurrently from every serverless instance.

## Realtime selection

Ably/Pusher should support authenticated channel authorization, presence if needed, message history/recovery where available, and regional service reliability. Compare current pricing, limits, data residency and Vercel integration before selecting.

## Why not a custom always-on WebSocket server initially?

Vercel serverless functions are not designed to host a permanently running socket server. A managed realtime provider is a simpler and more reliable fit for the first release.
