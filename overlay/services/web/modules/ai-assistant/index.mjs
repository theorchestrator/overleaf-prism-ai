import AiAssistantRouter from './app/src/AiAssistantRouter.mjs'
import logger from '@overleaf/logger'
import { AiConversation } from './app/src/models/AiConversation.mjs'
import { AiMessage } from './app/src/models/AiMessage.mjs'
import { AiPatchProposal } from './app/src/models/AiPatchProposal.mjs'
import { AiSettings } from './app/src/models/AiSettings.mjs'
import { AiUsage } from './app/src/models/AiUsage.mjs'

Promise.all(
  [AiConversation, AiMessage, AiPatchProposal, AiSettings, AiUsage].map(model =>
    model.createIndexes()
  )
).catch(error => logger.error({ err: error }, 'failed to create AI Assistant indexes'))

/** @type {import('../../types/web-module').WebModule} */
const AiAssistantModule = {
  name: 'ai-assistant',
  router: AiAssistantRouter,
}

export default AiAssistantModule
