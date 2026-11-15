# Analytics and Reporting

## Hotel dashboard
- Total active rooms.
- Occupied, vacant, blocked and out-of-order rooms.
- Arrivals and departures today.
- Housekeeping readiness.
- New, open, in-progress and overdue requests.
- Requests by department and service type.
- Average and percentile acknowledgement/completion times.

## Reports
- Occupancy by day/date range.
- Room readiness and housekeeping productivity.
- Request volume by category/department/room.
- Response and completion performance.
- Cancelled/reopened request rate.
- Staff workload and assignment history.
- Guest feedback and ratings.
- Revenue reports only where billing/POS data is integrated.

## SaaS operator reports
- Active/trialing/suspended tenants.
- Active rooms and staff seats.
- Subscription MRR/ARR (based on billing records).
- Churn and plan conversion.
- Feature usage.
- Provider costs and notification volume.

## Metric definitions

Document every metric precisely. Example:
- Occupancy rate = occupied sellable rooms / total sellable rooms for the selected interval.
- Acknowledgement time = acknowledged_at - submitted_at.
- Completion time = completed_at - submitted_at.
- Exclude blocked/out-of-order rooms from sellable inventory where hotel policy defines them as unavailable.

## Data integrity
- Store raw operational events and derive reports from them.
- Use property timezone for date boundaries.
- Avoid double-counting reopened requests.
- Restrict every report by tenant and authorized property scope.
- Use pagination and pre-aggregation for large date ranges.
