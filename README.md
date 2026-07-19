# Overleaf Prism AI

A project-aware, reviewed AI assistant for self-hosted Overleaf CE+. It adds Prism-like manuscript chat and safe edit proposals while keeping Overleaf's collaborative OT editing model intact.

> Status: Reviewed Editing Preview for `overleafcep/sharelatex:6.2.0-ext-v5.0`, source revision `c7579e3e74b0b23c3cfd969b0b90ef1daf0a6b55`. Test on copied projects before production use.

## What works

- Streaming, project-scoped conversations stored in local MongoDB.
- Context tools for listing, reading, and searching current `.tex`, `.bib`, and other text documents.
- Current selection and compiler-error context.
- An **Edit with AI** action in Overleaf's native selection toolbar.
- Structured multi-file patch proposals with exact old text, offsets, base hashes, and explanations.
- Inline CodeMirror diff previews with per-hunk Undo/Keep controls and chat-side review state.
- Explicit per-hunk or per-file approval, with direct-edit or Track Changes application modes. Accepted edits go through CodeMirror and Overleaf OT, never direct database or filesystem writes.
- Stale-patch blocking before and immediately before application.
- Project file discovery and source-comment tools, plus line-addressed patch operations for reliable insertions and replacements.
- Overleaf editor tabs, polished conversation controls, local conversation deletion, and in-panel confirmation.
- Admin allowlist, global kill switch, daily request limits, monthly token limits, timeouts, cancellation, local usage accounting, and `store:false`.
- Sanitized Markdown rendering; the provider credential and base URL stay in the server environment.

Not implemented yet: scholarly-source adapters, image-to-LaTeX, voice, review comments, and the full project-owner/admin UI. These are tracked as Phase 2 and Phase 3 work.

## Security model

The model can only list/read/search project text, inspect supplied compiler diagnostics, request that the client offer a compile, and propose a patch. It cannot use a shell, Docker, MongoDB, server paths, arbitrary URLs, or apply edits. Manuscripts and tool results are explicitly treated as untrusted data.

Relevant manuscript context is sent to the administrator-configured Responses-compatible provider. Conversations, proposals, approvals, and usage are retained locally. Requests use `store:false`; the configured provider and any upstream service may still have their own retention and safety policies.

See [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md).

## Build

```sh
docker build \
  --build-arg OVERLEAF_BASE_IMAGE=overleafcep/sharelatex:6.2.0-ext-v5.0 \
  -t overleaf-prism-ai:0.2.0-preview.1 .
```

The multi-stage build restores the dependencies pinned by Overleaf's lockfile, compiles the frontend, and produces a derivative image. It never modifies a running container.

## Configuration

Add these only to the Overleaf container environment or a protected environment file:

```dotenv
OVERLEAF_AI_ENABLED=true
OPENAI_API_KEY=replace-me
OVERLEAF_AI_BASE_URL=https://api.openai.com/v1
OVERLEAF_AI_PROVIDER_LABEL=OpenAI API
OVERLEAF_AI_ALLOWED_USER_IDS=64f000000000000000000000
OVERLEAF_AI_MODEL=gpt-5.6-sol
OVERLEAF_AI_REASONING_EFFORT=high
OVERLEAF_AI_DAILY_REQUEST_LIMIT=30
OVERLEAF_AI_MONTHLY_TOKEN_LIMIT=2000000
OVERLEAF_AI_REQUEST_TIMEOUT_MS=180000
OVERLEAF_AI_MAX_CONTEXT_CHARS=300000
```

AI stays unavailable unless the global switch, API key, and user allowlist all permit the request. `*` is supported for development but is not recommended for an internet-reachable instance.

For a server-controlled Responses-compatible proxy, use the generic credential
variable and an explicit base URL. `OVERLEAF_AI_API_KEY` takes precedence over
the backwards-compatible `OPENAI_API_KEY` variable:

```dotenv
OVERLEAF_AI_API_KEY=replace-with-proxy-token
OVERLEAF_AI_BASE_URL=http://chatmock.internal:18000/v1
OVERLEAF_AI_PROVIDER_LABEL=ChatMock (local network)
OVERLEAF_AI_MODEL=gpt-5.6-sol-medium
OVERLEAF_AI_REASONING_EFFORT=medium
```

The base URL is trusted deployment configuration and is never accepted from a
browser or admin API request. A locally hosted proxy does not imply local model
inference: review the proxy's upstream authentication, data flow, retention,
and terms before sending manuscripts through it.

Optional cost estimates require current prices supplied by the administrator:

```dotenv
OVERLEAF_AI_INPUT_USD_PER_MILLION=0
OVERLEAF_AI_OUTPUT_USD_PER_MILLION=0
```

Do not put provider credentials in `docker-compose.yml`, Git, browser code, MongoDB, or the admin API.

## Verification

```sh
npm test
npm run check:overlay
docker image inspect overleaf-prism-ai:0.2.0-preview.1
```

GitHub Actions runs the repository checks for pushes and pull requests. A tag
matching `v*` additionally publishes the pinned `linux/amd64` image to GHCR and
creates a prerelease with generated notes.

For deployment, back up MongoDB and Overleaf data first, retain the previous image tag, change only the toolkit image/environment settings, and test collaboration, compilation, comments, Zotero, Git Bridge, and WebSockets.

## Prior art and attribution

The editor rail, selection-assistant, inline-completion, and compiler-action ideas were evaluated against [yu-i-i/overleaf-cep PR #171](https://github.com/yu-i-i/overleaf-cep/pull/171), by David Rotermund, which itself notes adaptation from `lcpu-club/overleaf`. This project uses a new constrained backend and reviewed-patch workflow rather than shipping that PR unchanged. Overleaf and Overleaf CE+ remain separate upstream projects and trademarks of their respective owners.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
