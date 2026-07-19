import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { expressify } from '@overleaf/promise-utils'
import AiAssistantController from './AiAssistantController.mjs'

const read = AuthorizationMiddleware.ensureUserCanReadProject
const write = AuthorizationMiddleware.ensureUserCanWriteProjectContent
const login = AuthenticationController.requireLogin()

function checked(handler) {
  return expressify(async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end()
        return
      }
      res.status(error?.statusCode || 500).json({ error: error?.message || 'AI request failed.' })
    }
  })
}

export default {
  apply(router) {
    router.get('/project/:Project_id/ai/settings', read, checked(AiAssistantController.publicSettings))
    router.get('/project/:Project_id/ai/usage', read, checked(AiAssistantController.usage))
    router.get('/project/:Project_id/ai/conversations', read, checked(AiAssistantController.listConversations))
    router.get('/project/:Project_id/ai/conversations/:conversationId', read, checked(AiAssistantController.getConversation))
    router.delete('/project/:Project_id/ai/conversations/:conversationId', read, checked(AiAssistantController.deleteConversation))
    router.post('/project/:Project_id/ai/responses', read, checked(AiAssistantController.responses))
    router.post('/project/:Project_id/ai/patches/:patchId/validate', write, checked(AiAssistantController.validatePatch))
    router.post('/project/:Project_id/ai/patches/:patchId/record', write, checked(AiAssistantController.recordPatch))

    router.get('/admin/ai-assistant/settings', login, AuthorizationMiddleware.ensureUserIsSiteAdmin, checked(AiAssistantController.adminSettings))
    router.get('/admin/ai-assistant/usage', login, AuthorizationMiddleware.ensureUserIsSiteAdmin, checked(AiAssistantController.adminUsage))
    router.post('/admin/ai-assistant/settings', login, AuthorizationMiddleware.ensureUserIsSiteAdmin, checked(AiAssistantController.saveAdminSettings))
  },
}
