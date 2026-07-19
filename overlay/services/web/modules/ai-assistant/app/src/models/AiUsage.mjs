import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

const AiUsageSchema = new Schema(
  {
    userId: { type: ObjectId, required: true },
    day: { type: String, required: true },
    month: { type: String, required: true },
    requests: { type: Number, required: true, default: 0 },
    inputTokens: { type: Number, required: true, default: 0 },
    outputTokens: { type: Number, required: true, default: 0 },
    estimatedCostMicros: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, minimize: false }
)

AiUsageSchema.index({ userId: 1, day: 1 }, { unique: true })
AiUsageSchema.index({ userId: 1, month: 1 })

export const AiUsage = mongoose.model('AiUsage', AiUsageSchema)
