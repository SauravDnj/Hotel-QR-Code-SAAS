# Zprompt — AI Build Prompt Pack

This folder contains reusable prompts for an AI coding assistant (Cursor, Claude Code, ChatGPT Work or similar).

## Recommended usage

1. Open the repository and provide `00_MASTER_BUILD_PROMPT.md` as project-wide instructions.
2. Ask the agent to inspect the existing codebase before changing files.
3. Give one focused phase prompt at a time.
4. Require a plan before implementation for large changes.
5. Require migrations, tests, authorization and documentation with every feature.
6. Review diffs and run tests before merging.
7. Never paste production secrets into prompts or commit generated secrets.

## Rules for every prompt

- Read the relevant documentation under `docs/` first.
- Do not invent requirements when the docs are silent; list assumptions and ask.
- Preserve established patterns and avoid unnecessary rewrites.
- Implement server-side validation and authorization.
- Enforce tenant/property/department scope in every query and realtime subscription.
- Add migrations, tests, loading/empty/error states and audit events as applicable.
- Do not claim a feature is complete unless tests and build pass.
- Do not use mock data as a substitute for production functionality.
- Keep the product deployable on Vercel; use managed external services for durable database, realtime and background work.
