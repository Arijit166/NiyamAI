import { Schema, models, model } from 'mongoose'

export type InvitationRole = 'executive_officer' | 'senior_officer'
export type InvitationStatus = 'pending' | 'used' | 'revoked'

export interface IInvitation {
  email: string
  role: InvitationRole
  identificationCode: string
  jurisdictionCity: string | null
  jurisdictionState: string | null
  status: InvitationStatus
  invitedBy: string
  usedAt?: Date | null
  createdAt: Date
}

const InvitationSchema = new Schema<IInvitation>({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  role: { type: String, enum: ['executive_officer', 'senior_officer'], required: true },
  identificationCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
  jurisdictionCity: { type: String, default: null },
  jurisdictionState: { type: String, default: null },
  status: { type: String, enum: ['pending', 'used', 'revoked'], default: 'pending' },
  invitedBy: { type: String, required: true },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
})

InvitationSchema.index({ email: 1, status: 1 })

export default models.Invitation || model<IInvitation>('Invitation', InvitationSchema)