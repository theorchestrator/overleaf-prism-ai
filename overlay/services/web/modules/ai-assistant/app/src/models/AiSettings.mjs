import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

const AiSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    enabled: { type: Boolean, required: true, default: true },
    allowedUserIds: { type: [ObjectId], default: [] },
    dailyRequestLimit: { type: Number, min: 1 },
    monthlyTokenLimit: { type: Number, min: 1 },
    updatedBy: { type: ObjectId },
  },
  { timestamps: true, minimize: false }
)

export const AiSettings = mongoose.model('AiSettings', AiSettingsSchema)
