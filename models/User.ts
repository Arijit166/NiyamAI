import { Schema, models, model } from 'mongoose'

export type UserRole = 'admin' | 'executive_officer' | 'senior_officer'
export type AuthProvider = 'credentials' | 'google'

export interface IUser {
  name: string
  email: string
  password?: string
  image?: string
  role: UserRole | null
  authProvider: AuthProvider
  lastActiveAt?: Date | null  
  jurisdictionCity?: string | null   
  jurisdictionState?: string | null 
  identificationCode?: string | null
  idProofType?: 'aadhar' | 'pan' | null
  idProofUrl?: string | null
  invitationId?: string | null
  createdAt: Date
}

const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, select: false },
  image: { type: String },
  role: { type: String, enum: ['admin', 'executive_officer', 'senior_officer'], default: null },
  authProvider: { type: String, enum: ['credentials', 'google'], required: true },
  lastActiveAt: { type: Date, default: null },
  jurisdictionCity: { type: String, default: null }, 
  jurisdictionState: { type: String, default: null },
  identificationCode: { type: String, default: null, unique: true, sparse: true },
  idProofType: { type: String, enum: ['aadhar', 'pan'], default: null },
  idProofUrl: { type: String, default: null },
  invitationId: { type: String, default: null }, 
  createdAt: { type: Date, default: Date.now },
})

export default models.User || model<IUser>('User', UserSchema)