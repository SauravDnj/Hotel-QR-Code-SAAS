# Core Workflows

## 1. Hotel onboarding
1. SaaS admin or signup creates tenant.
2. Create first tenant membership as owner.
3. Owner configures property, timezone, currency and branding.
4. Owner creates departments and staff roles.
5. Owner creates floors, room categories and rooms.
6. System generates QR tokens and printable QR sheets.
7. Owner configures Wi-Fi and guest services.
8. Test QR in a real phone browser before hotel launch.

## 2. Guest QR scan and request
1. Guest scans room QR.
2. Server resolves active QR to room/property/tenant.
3. Guest portal renders safe hotel and room content.
4. Guest taps service tile.
5. Guest optionally selects quantity/options and adds note.
6. Server validates service availability and rate limits.
7. Request, history and outbox event are saved transactionally.
8. Guest receives a reference and status view.
9. Department staff receive a realtime event and durable inbox item.
10. Staff accept, work and complete; guest sees safe progress.

## 3. Water bottle request
- Tile: Water Bottle.
- Route: Room Service (configurable).
- Fields: quantity (default 1), optional note.
- Priority: normal.
- Acknowledgement: “Your request has been sent.”
- Completion: staff marks delivered; guest status becomes completed.

## 4. Housekeeping request
- Tile: Clean My Room.
- Route: Housekeeping.
- Optional choices: full cleaning, quick refresh, do-not-disturb removal request (hotel policy).
- Task is visible in housekeeping queue.
- Staff marks in progress and completed.
- If guest requests cleaning while DND is active, follow hotel policy and avoid entering without permission.

## 5. Maintenance request
- Tile: Report a Problem.
- Options: AC, TV, plumbing, lighting, Wi-Fi, other.
- Optional note and photo (later).
- Route to Maintenance; manager escalation based on priority and age.

## 6. Reception request
- Tile: Contact Reception.
- Create request or initiate a phone link if a public reception number is configured.
- Request is routed to Reception.
- Do not assume browser can place a call without user confirmation.

## 7. Check-in
1. Reception selects a room and creates/opens stay.
2. Validate room is active, not blocked and available.
3. Record check-in timestamp and expected checkout.
4. Room occupancy becomes occupied by active stay.
5. QR remains room-linked; guest sees only public room services unless a secure stay session is issued.

## 8. Check-out
1. Reception confirms departure.
2. Close stay with actual checkout timestamp.
3. Create housekeeping task automatically.
4. Housekeeping state becomes dirty/needs cleaning.
5. Room remains unavailable for new occupancy until cleaned and inspected according to hotel policy.
6. Manager/reception sees readiness update.

## 9. Staff shift and request handover
- Staff queue is department-scoped.
- Reassigning a request records previous and new assignee.
- Open tasks remain in department queue if assigned staff goes offline.
- Manager can see unassigned and overdue requests.

## 10. QR replacement
- Admin requests rotation.
- New random token generated and QR asset created.
- Old token revoked immediately or at scheduled cutover.
- Print new QR; audit who rotated it and why.
