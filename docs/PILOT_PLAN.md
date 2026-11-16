# Pilot plan (one hotel, 2 weeks)

Goal: prove the product in a real hotel with real phones before wider launch (`ROADMAP_AND_PHASES.md` Phase 8).
Exit: the hotel and the platform owner sign the acceptance table below, and no Critical/High issues are open.

## Day 0: setup (platform owner + hotel manager, ~2 hours)
1. Create the hotel account (or invite the owner), set timezone/currency, and extend the trial for the pilot period (`/platform` → Extend trial).
2. Set up the hotel structure:
   1. property → floors, room types, rooms (bulk range);
   2. **Services** → "Add standard services" → adjust hours/targets;
   3. **Guest portal** → Wi-Fi, reception phone, check-in/out times, breakfast/info sections, logo/colour.
3. **Staff**:
   1. invite reception, housekeeping, room service and maintenance (copy links);
   2. each person signs in on their own phone and installs "Hotel Staff" to the home screen;
   3. owner/managers turn on two-step sign-in.
4. **Print QR sheets** per floor (QR codes → Print sheet → Save as PDF → print on sticker paper). Check the size: at least 3 cm wide.
5. **Room-by-room audit:** QR codes → *Start room-by-room audit*, stick and scan every room with iPhone **and** Android camera apps, and confirm "N of N verified". Replace any sticker that fails.

## Daily during the pilot
- The hotel keeps the Requests page open at reception (sound on).
- The platform owner checks `/platform/support` each morning (`docs/RUNBOOK.md`).
- Collect feedback in a shared sheet: date, who, screen, what happened, severity.

## Test script (run on day 1 with real devices)
| # | Scenario | Expected |
|---|---|---|
| 1 | Guest scans room QR (iPhone Safari, Android Chrome) | Hotel page opens in under 3 s, room number correct, Wi-Fi visible, copy works |
| 2 | Guest orders water | Request appears at reception/room service within 10 s; guest sees "Request sent" |
| 3 | Staff accept → start → complete with a message | Guest page shows each step and the message; internal note not shown |
| 4 | Housekeeping staff opens inbox | Sees only housekeeping requests |
| 5 | Reception checks a guest in, then out | Checkout creates a cleaning task; room NOT offered for check-in |
| 6 | Housekeeping cleans; a different person inspects | Room becomes ready only after inspection |
| 7 | Manager replaces one room's QR | Old sticker shows "isn't active"; new sticker works |
| 8 | Staff phone offline for 2 min while a guest orders | Request appears when the phone reconnects |
| 9 | Request left unaccepted past target time | Shows "Escalated" for managers (next poll/cron) |
| 10 | Owner opens Reports and Billing | Numbers match the day's activity; plan/usage correct |

## Acceptance (sign-off)
| Criterion | Hotel | Platform owner |
|---|---|---|
| All QR stickers verified on iOS and Android | ☐ | ☐ |
| Test script 1–10 passed | ☐ | ☐ |
| No lost or duplicated requests during the pilot | ☐ | ☐ |
| Staff can do their daily work without help | ☐ | ☐ |
| No open Critical/High issues (`docs/SECURITY_REVIEW.md`) | — | ☐ |
| Backup/restore drill done (`docs/RUNBOOK.md`) | — | ☐ |

Signed: ____________________ (hotel) ____________________ (platform) Date: __________
