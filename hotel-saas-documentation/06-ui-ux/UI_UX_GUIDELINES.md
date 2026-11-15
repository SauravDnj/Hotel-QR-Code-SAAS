# UI/UX Guidelines

## Experience families

### Guest portal
- Mobile-first, no login for basic services.
- One-screen welcome and clearly grouped actions.
- Large touch targets (aim for 44px minimum).
- Plain language and recognizable icons.
- Keep critical action within one or two taps.
- Clear confirmation and progress status.
- No dense tables or admin-style navigation.
- Accessible contrast, labels and focus states.

### Staff PWA
- Mobile-first task inbox.
- Persistent visible room number, service and age.
- Strong distinction between new, in-progress and completed.
- One-tap accept/start/complete with confirmation for destructive actions.
- Sound/vibration only where supported and user-enabled.
- Offline/reconnect state clearly indicated.
- Install prompt is optional and non-blocking.

### Reception
- Room grid/list with occupancy and housekeeping indicators.
- Arrivals, departures and open reception requests.
- Fast room search.
- Check-in/out forms with validation and confirmation.
- Do not use color as the only status indicator.

### Hotel admin
- Desktop-first responsive sidebar and top bar.
- Dashboard cards, charts, filterable tables and bulk actions.
- Clear empty/loading/error states.
- Permission-aware navigation, backed by server authorization.
- Destructive actions require confirmation and audit.

### SaaS operator
- Tenant list, plan status, usage, billing and support tools.
- Support access visibly marked and audited.
- Platform-wide metrics separated from tenant operational data.

## Visual direction

- Premium hospitality feel: calm neutrals, deep navy/charcoal, one configurable accent color.
- Hotel guest portal uses tenant logo, colors and optional cover image.
- Avoid visual clutter, tiny text and excessive gradients.
- Consistent spacing, typography, radius, shadows and icon style.
- Use design tokens; do not hardcode each screen independently.

## Required states

Every data-driven screen should include:
- loading/skeleton;
- empty state with next action;
- validation error;
- permission denied;
- network/provider failure;
- success confirmation;
- stale/reconnecting realtime state.

## Accessibility and localization

- Semantic headings and buttons.
- Keyboard access and visible focus.
- Screen-reader labels for icon-only buttons.
- Text contrast appropriate to WCAG guidance.
- Avoid relying only on color.
- Prepare for English first and future language translations.
- Format time in property timezone and currency by property setting.
