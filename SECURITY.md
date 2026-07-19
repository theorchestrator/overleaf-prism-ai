# Security policy

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories. Do not include manuscript data, API keys, session cookies, or production database exports in an issue.

## Deployment requirements

- Keep `OVERLEAF_AI_API_KEY` or `OPENAI_API_KEY` only in a root-readable/container-secret environment source.
- Configure `OVERLEAF_AI_BASE_URL` only in the server environment. Never expose provider URL selection to users or the browser.
- Keep AI disabled by default and use explicit user IDs in the allowlist.
- Keep Overleaf, CE+, MongoDB, Redis, and the reverse proxy patched.
- Back up data and retain the previous image before each upgrade.
- Do not expose the Overleaf origin directly when a trusted reverse proxy is expected.
- Review the configured provider and its upstream service's retention, authentication, terms, and regional/data-processing requirements for manuscripts.

## Trust boundaries

Project documents, bibliography data, compile logs, model output, attachments, and future literature results are untrusted. They never grant tools or permissions. Project authorization is repeated on every endpoint. Model output is schema-validated before it becomes a proposal and sanitized before browser rendering.

The browser is the only patch executor. It rechecks the active document hash, applies accepted changes through CodeMirror/OT, and reports an audit outcome. The backend never edits an Overleaf document.

## Known preview limitations

- Quotas are administrative guardrails, not a prepaid billing boundary; concurrent requests can marginally exceed a limit.
- The Phase 1 admin controls are API/environment based; a dedicated admin UI is pending.
- Per-hunk application is a one-shot action against the proposal's base hash. Apply all desired hunks from that file together; remaining hunks must be regenerated afterward.
