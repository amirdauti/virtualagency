# Nango Integration (Google OAuth + Agent Access)

This project includes Nango Cloud integration scaffolding for Google OAuth and agent-side Nango proxy access.

## Server env

Set these in the Virtual Agency server environment:

```bash
NANGO_SECRET_KEY=your_nango_secret_key
NANGO_BASE_URL=https://api.nango.dev
```

- `NANGO_SECRET_KEY` is required.
- `NANGO_BASE_URL` is optional and defaults to `https://api.nango.dev`.

## Hosted mode env sync

Hosted Nango is handled on the control plane. Do not place the shared Nango secret on user VPS runtime.

Set these on the billing API service:

```bash
HOSTED_NANGO_SECRET_KEY=your_nango_secret_key
HOSTED_NANGO_BASE_URL=https://api.nango.dev
```

`HOSTED_NANGO_SECRET_KEY` also falls back to `NANGO_SECRET_KEY` on the billing API process.

## Web/Desktop connect flow

Endpoint used by the Integrations panel:

- `POST /api/integrations/nango/connect-session`
- `POST /api/integrations/nango/connections`
- `DELETE /api/integrations/nango/connections`

Request body:

```json
{
  "integration_id": "google",
  "end_user_id": "agent-id",
  "end_user_email": "optional@example.com",
  "end_user_display_name": "optional display name"
}
```

Response body:

```json
{
  "session_token": "nango_connect_session_token",
  "integration_id": "google",
  "nango_base_url": "https://api.nango.dev",
  "expires_at": "optional",
  "connect_link": "optional"
}
```

The Integrations panel opens Nango Connect in a new window for the user to complete OAuth.

List connections request:

```json
{
  "end_user_id": "agent-id",
  "integration_id": "google"
}
```

Delete connection request:

```json
{
  "end_user_id": "agent-id",
  "integration_id": "google",
  "connection_id": "nango_connection_id"
}
```

In hosted mode, billing proxy forwards the authenticated user id (`x-va-user-id`) and the server namespaces the Nango `end_user.id` as:

`<hosted_user_id>:<agent_id>`

This avoids cross-user connection collisions.

## Agent tools endpoints (control plane)

All endpoints below require:
- header: `x-va-agent-token: $VA_CONTROL_TOKEN`
- base path: `/api/agent-tools/:source_agent_id/...`

### 1) Create Nango connect session for an agent

- `POST /nango-connect-session`

```json
{
  "target_agent_id": "optional-target-agent-id",
  "integration_id": "google"
}
```

If `target_agent_id` is omitted, the source agent is used.
Cross-agent access is blocked by default (`target_agent_id` must equal `source_agent_id`).

### 2) List Nango connections for an agent

- `POST /nango-connections`

```json
{
  "target_agent_id": "optional-target-agent-id",
  "integration_id": "google"
}
```
Cross-agent access is blocked by default (`target_agent_id` must equal `source_agent_id`).

### 3) Proxy provider API calls through Nango

- `POST /nango-proxy`

```json
{
  "target_agent_id": "optional-target-agent-id",
  "integration_id": "google",
  "method": "POST",
  "endpoint": "/gmail/v1/users/me/messages/send",
  "body": {
    "raw": "<base64url_encoded_rfc822_message>"
  }
}
```

If `connection_id` is omitted, the server resolves it from Nango connections using:
- `integration_id`
- `target_agent_id` as `end_user.id` (or `<user_id>:<target_agent_id>` in hosted mode)

If `connection_id` is provided, ownership is still validated against the same target agent + integration.

## Example agent proxy calls

### Read Gmail labels

```json
{
  "integration_id": "google",
  "method": "GET",
  "endpoint": "/gmail/v1/users/me/labels"
}
```

### List Drive files

```json
{
  "integration_id": "google",
  "method": "GET",
  "endpoint": "/drive/v3/files",
  "query": {
    "pageSize": "10",
    "fields": "files(id,name,mimeType)"
  }
}
```

### Create a Google Doc

```json
{
  "integration_id": "google",
  "method": "POST",
  "endpoint": "/docs/v1/documents",
  "body": {
    "title": "Virtual Agency Test Doc"
  }
}
```

## Troubleshooting

- `NANGO_SECRET_KEY is not configured on the server`
  - Local mode: set `NANGO_SECRET_KEY` for the server process and restart.
  - Hosted mode: set `HOSTED_NANGO_SECRET_KEY` (or `NANGO_SECRET_KEY`) on billing API and restart `virtualagency-billing-api`.
- `no Nango connection found for target agent ...`
  - run connect flow for that agent and integration first.
- Google OAuth warnings/verification screen
  - expected in test mode; production rollout requires Google OAuth verification for sensitive/restricted scopes.
