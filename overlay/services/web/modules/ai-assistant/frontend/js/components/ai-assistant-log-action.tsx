import { memo } from 'react'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

function AiAssistantLogAction({ logEntry }: { logEntry?: Record<string, unknown> }) {
  if (!logEntry || logEntry.level !== 'error') return null
  const ask = () => {
    window.dispatchEvent(new CustomEvent('ui:select-rail-tab', { detail: { tab: 'ai-assistant', open: true } }))
    window.dispatchEvent(new CustomEvent('ai-assistant:prompt', {
      detail: {
        prompt: 'Diagnose this LaTeX compiler error and propose a minimal reviewed patch.',
        compilerDiagnostics: JSON.stringify(logEntry),
      },
    }))
  }
  return (
    <OLTooltip id={`ai-fix-${String(logEntry.key || '')}`} description="Fix with AI" overlayProps={{ placement: 'bottom' }}>
      <OLIconButton onClick={ask} variant="ghost" icon="smart_toy" accessibilityLabel="Fix with AI" />
    </OLTooltip>
  )
}

export default memo(AiAssistantLogAction)
