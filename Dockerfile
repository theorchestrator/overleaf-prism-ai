ARG OVERLEAF_BASE_IMAGE=overleafcep/sharelatex:6.2.0-ext-v5.0
FROM ${OVERLEAF_BASE_IMAGE} AS builder

USER root
RUN cd /overleaf && yarn install --immutable
COPY overlay/ /tmp/overleaf-ai-overlay/
COPY scripts/install-overlay.mjs /tmp/install-overlay.mjs
RUN node /tmp/install-overlay.mjs /overleaf /tmp/overleaf-ai-overlay \
  && cd /overleaf/services/web \
  && yarn run webpack:production

FROM ${OVERLEAF_BASE_IMAGE}
ARG OVERLEAF_SOURCE_REVISION=c7579e3e74b0b23c3cfd969b0b90ef1daf0a6b55
LABEL org.opencontainers.image.title="Overleaf Prism AI" \
      org.opencontainers.image.description="Project-aware reviewed AI assistance for Overleaf CE+" \
      org.opencontainers.image.source="https://github.com/theorchestrator/overleaf-prism-ai" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.overleaf.revision="${OVERLEAF_SOURCE_REVISION}"
USER root
COPY --from=builder /overleaf/services/web/modules/ai-assistant /overleaf/services/web/modules/ai-assistant
COPY --from=builder /overleaf/services/web/config/settings.defaults.js /overleaf/services/web/config/settings.defaults.js
COPY --from=builder /overleaf/services/web/frontend/js/features/ide-react/context/rail-context.tsx /overleaf/services/web/frontend/js/features/ide-react/context/rail-context.tsx
COPY --from=builder /overleaf/services/web/public /overleaf/services/web/public
RUN chmod -R a+rX /overleaf/services/web/modules/ai-assistant
