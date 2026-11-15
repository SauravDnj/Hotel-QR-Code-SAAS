# Prompt 07 — Guest Stays, Check-in/Check-out and Housekeeping

Read workflows, database, PRD and security docs. Implement:
- Minimal guest profile and stay record.
- Reception check-in and expected checkout.
- One active stay per room where business rules require it.
- Check-out with actual timestamp.
- Transactionally create housekeeping task at checkout.
- Cleaning, inspection and room-ready transitions.
- Room occupancy separate from room operational and housekeeping states.
- Prevent room allocation when blocked, out of order or not ready according to hotel policy.
- Audit, concurrency protection and tests for duplicate checkout/cleaning task.

Do not build a full OTA reservation/channel manager in this phase.
