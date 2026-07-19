import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

const AiConversationSchema = new Schema(
  {
    projectId: { type: ObjectId, required: true, index: true },
    userId: { type: ObjectId, required: true, index: true },
    title: { type: String, required: true, maxlength: 160 },
  },
  { timestamps: true, minimize: false }
)

AiConversationSchema.index({ projectId: 1, userId: 1, updatedAt: -1 })

export const AiConversation = mongoose.model(
  'AiConversation',
  AiConversationSchema
)
