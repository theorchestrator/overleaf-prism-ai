# Contributing

Contributions are welcome under AGPL-3.0-only.

1. Keep changes narrowly compatible with the pinned CE+ revision.
2. Never add direct document database/filesystem writes, unrestricted network tools, shell access, or browser-visible credentials.
3. Route every edit through a reviewed patch and CodeMirror/OT.
4. Add tests for authorization, schema validation, prompt-injection boundaries, and failure behavior.
5. Run `npm test` and `npm run check:overlay` before opening a pull request.

Do not submit real manuscripts, API keys, or production logs as fixtures.
