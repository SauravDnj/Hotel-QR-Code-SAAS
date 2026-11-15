# Prompt 05 — Realtime Notifications and Staff Inbox

Read realtime, RBAC, request state machine and operations docs. Implement:
- Department routing snapshots.
- Durable outbox publisher integration.
- Authenticated tenant/property/department realtime channels.
- Staff inbox backed by database.
- New request alert, sound preference and unread count.
- Accept, assign, start, complete, cancel and reopen transitions.
- Guest-safe status update.
- Retry/reconnect and missed-event recovery.
- Optional push notification as a separately permissioned enhancement.

Never broadcast sensitive guest data. Never rely on realtime as the only record. Test that staff from another tenant or department cannot subscribe or act.
