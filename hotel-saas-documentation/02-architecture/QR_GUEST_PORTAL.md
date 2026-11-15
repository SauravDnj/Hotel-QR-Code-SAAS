# QR Codes and Guest Portal

## QR design

Each room receives a unique QR URL such as:

`https://guest.example.com/r/<opaque-random-token>`

The token must be cryptographically random, non-sequential and unguessable. Do not encode raw room IDs, tenant IDs, guest IDs, phone numbers or stay details.

## QR lifecycle

- Create QR when room is created or when admin requests it.
- Preview before printing.
- Download individual QR as PNG/SVG/PDF.
- Bulk generate printable sheets by floor.
- Activate/deactivate.
- Rotate token after suspected compromise or room reassignment policy.
- Keep historical QR records for audit.
- Show last scanned time and scan count only if privacy policy allows.

## Public route resolution

1. Receive opaque token.
2. Hash token and find active QR record.
3. Resolve room, property and tenant on server.
4. Confirm tenant/property/room are active and guest portal enabled.
5. Load only guest-safe public configuration.
6. Apply rate limiting and abuse protection.
7. Never accept a room or tenant override from client input.

## Guest portal content

- Hotel identity and branding.
- Room label (hotel may choose whether to show it).
- Wi-Fi SSID and password with copy action.
- Hotel services and service hours.
- Hotel facilities, dining times, policies and contact options.
- Guest service request tiles.
- Request receipt and status.

## Guest identity and stay privacy

Scanning a room QR does not authenticate the guest. Basic room service requests can be anonymous or associated with a short-lived guest session. Private booking details, invoices, identity documents and previous guest history must not be shown through a public QR.

If the hotel wants stay-specific actions, add a secure verification method such as a short code delivered by reception, reservation-specific magic link, or staff-issued guest PIN. Do not rely on room number alone.

## Wi-Fi credentials

- Encrypt sensitive credentials at rest using managed key/secrets strategy where practical.
- Restrict admin access to view/update.
- Only return credentials from the intended room/property guest endpoint.
- Avoid logging response bodies.
- Support credential rotation.
- Consider a guest-accessible network with client isolation and bandwidth controls configured on hotel network equipment.
