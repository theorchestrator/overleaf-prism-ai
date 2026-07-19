# Security policy

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories. Do not include manuscript data, API keys, session cookies, or production database exports in an issue.

## Deployment requirements

- Keep `OPENAI_API_KEY` only in a root-readable/container-secret environment source.
- Keep AI disabled by default and use explicit user IDs in the allowlist.
- Keep Overleaf, CE+, MongoDB, Redis, and the reverse proxy patched.
- Back up data and retain the previous image before each upgrade.
- Do not expose the Overleaf origin directly when a trusted reverse proxy is expected.
- Review OpenAI API retention and regional/data-processing requirements for your manuscripts.

## Trust boundaries

Project documents, bibliography data, compile logs, model output, attachments, and future literature results are untrusted. They never grant tools or permissions. Project authorization is repeated on every endpoint. Model output is schema-validated before it becomes a proposal and sanitized before browser rendering.

The browser is the only patch executor. It rechecks the active document hash, applies accepted changes through CodeMirror/OT, and reports an audit outcome. The backend never edits an Overleaf document.

## Known preview limitations

- Quotas are administrative guardrails, not a prepaid billing boundary; concurrent requests can marginally exceed a limit.
- The Phase 1 admin controls are API/environment based; a dedicated admin UI is pending.
- Per-hunk application is a one-shot action against the proposal's base hash. Apply all desired hunks from that file together; remaining hunks must be regenerated afterward.
