import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { RailElement } from '@/features/ide-react/util/rail-types'
import AiAssistantPanel from './ai-assistant-panel'
import '../../stylesheets/ai-assistant.scss'

function AiAssistantRail() {
  return (
    <div className="ai-assistant-rail">
      <RailPanelHeader title="AI Assistant" />
      <AiAssistantPanel />
    </div>
  )
}

const entry: RailElement = {
  key: 'ai-assistant',
  icon: 'smart_toy',
  title: 'AI Assistant',
  component: <AiAssistantRail />,
  mountOnFirstLoad: true,
}

export default entry
