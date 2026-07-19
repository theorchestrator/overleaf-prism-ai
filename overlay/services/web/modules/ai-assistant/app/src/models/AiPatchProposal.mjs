import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

const AiPatchHunkSchema = new Schema(
  {
    from: { type: Number, required: true, min: 0 },
    to: { type: Number, required: true, min: 0 },
    // Insertions intentionally have empty oldText; deletions may have empty newText.
    oldText: { type: String, default: '' },
    newText: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { _id: false }
)

const AiPatchFileSchema = new Schema(
  {
    path: { type: String, required: true },
    docId: { type: ObjectId, required: true },
    baseVersion: { type: Number },
    baseHash: { type: String, required: true },
    hunks: { type: [AiPatchHunkSchema], required: true },
  },
  { _id: false }
)

const AiPatchProposalSchema = new Schema(
  {
    projectId: { type: ObjectId, required: true, index: true },
    userId: { type: ObjectId, required: true, index: true },
    conversationId: { type: ObjectId, required: true, index: true },
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, required: true, maxlength: 5000 },
    files: { type: [AiPatchFileSchema], required: true },
    status: {
      type: String,
      required: true,
      default: 'proposed',
      enum: ['proposed', 'partially-applied', 'applied', 'rejected', 'expired'],
    },
    applications: { type: [Schema.Types.Mixed], default: [] },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, minimize: false }
)

export const AiPatchProposal = mongoose.model(
  'AiPatchProposal',
  AiPatchProposalSchema
)
