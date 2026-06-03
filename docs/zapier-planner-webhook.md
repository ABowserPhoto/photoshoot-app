# Zapier Webhook: Planner Task Create

Use this endpoint in **Zapier Webhooks by Zapier -> Custom Request** to inject tasks into the Planner backend.

## Endpoint

- `POST /api/planner/tasks`
- Content-Type: `application/json`
- Auth: same session/cookie auth your app currently uses

## Sample JSON Payload

```json
{
  "title": "Wolt End-of-Month Social Pack",
  "description": "Generate and publish final social assets.",
  "status": "master",
  "assigned_to": null,
  "due_date": "2026-06-30T17:00:00.000Z",
  "label": "Social Media",
  "recurring_type": "none",
  "client_name": "Wolt",
  "total_fee": 450
}
```

## Expected Success Response

```json
{
  "ok": true,
  "data": {
    "id": "uuid-here",
    "title": "Wolt End-of-Month Social Pack",
    "status": "master",
    "client_name": "Wolt",
    "total_fee": 450
  }
}
```

## Notes

- `client_name` and `total_fee` are optional but recommended for monthly ledger reporting.
- `total_fee` accepts either a number (preferred) or numeric string.
- If omitted, `title` defaults to `"Untitled Task"` and billing fields are saved as `null`.
