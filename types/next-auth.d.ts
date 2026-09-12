import { UserRole } from '@/models/User'
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role: UserRole | null
      jurisdictionCity?: string | null   // NEW
      jurisdictionState?: string | null 
      identificationCode?: string | null   // NEW
      codeVerified?: boolean
      companyName?: string | null
      productName?: string | null
    }
  }
  interface User {
    id: string
    role?: UserRole | null
    jurisdictionCity?: string | null     // NEW
    jurisdictionState?: string | null
    identificationCode?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: UserRole | null
    jurisdictionCity?: string | null     // NEW
    jurisdictionState?: string | null
    hasIdentificationCode?: boolean   // NEW
    codeVerified?: boolean
  }
}