import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

const AiMessageSchema = new Schema(
  {
    conversationId: { type: ObjectId, required: true, index: true },
    projectId: { type: ObjectId, required: true, index: true },
    userId: { type: ObjectId, required: true, index: true },
    role: {
      type: String,
      required: true,
      enum: ['user', 'assistant'],
    },
    content: { type: String, required: true, maxlength: 1000000 },
    sources: { type: [Schema.Types.Mixed], default: [] },
    usage: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
)

AiMessageSchema.index({ conversationId: 1, createdAt: 1 })

export const AiMessage = mongoose.model('AiMessage', AiMessageSchema)
