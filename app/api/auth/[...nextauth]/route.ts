import NextAuth from 'next-auth/next'
import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import { cookies } from 'next/headers'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        identificationCode: { label: 'Identification Code', type: 'text' }, // NEW
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required.')
        }

        await connectDB()
        const user = await User.findOne({ email: credentials.email.toLowerCase() }).select('+password')

        if (!user) throw new Error('No account found with this email. Please sign up first.')
        if (user.authProvider === 'google') throw new Error('This email is registered with Google. Please sign in with Google.')

        const isValid = await bcrypt.compare(credentials.password, user.password as string)
        if (!isValid) throw new Error('Incorrect password. Please try again.')

        // NEW — officers must re-enter their identification code on every login
        if (user.identificationCode) {
          const supplied = String(credentials.identificationCode || '').trim().toUpperCase()
          if (!supplied) throw new Error('Please enter your identification code.')
          if (supplied !== user.identificationCode) throw new Error('That identification code does not match our records.')
        }

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          jurisdictionCity: user.jurisdictionCity ?? null,
          jurisdictionState: user.jurisdictionState ?? null,
          codeVerified: true,
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
        if (account?.provider === 'google') {
            const cookieStore = await cookies()
            const intent = cookieStore.get('auth_intent')?.value || 'login'

            await connectDB()
            const existing = await User.findOne({ email: user.email!.toLowerCase() })

            // this email already has a manual/password account — always blocked for Google
            if (existing && existing.authProvider === 'credentials') {
            return '/login?error=UseCredentials'
            }

            if (intent === 'signup') {
            // fully-registered Google account already exists -> this is a duplicate signup
            if (existing && existing.role) {
                return '/signup?error=AccountExists'
            }
            // brand new email -> create the record, role gets picked on /select-role
            if (!existing) {
                await User.create({
                name: user.name,
                email: user.email!.toLowerCase(),
                image: user.image,
                authProvider: 'google',
                role: null,
                })
            }
            return true
            }

            // intent === 'login'
            if (!existing) {
            return '/login?error=NoAccount'
            }
            return true
        }
        return true
        },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = (user as any).id
        token.role = (user as any).role ?? null
        const image = (user as any).image
        token.picture = image && image.length <= 2048 ? image : null
        token.jurisdictionCity = (user as any).jurisdictionCity ?? null
        token.jurisdictionState = (user as any).jurisdictionState ?? null

        // NEW — fresh login: does this account need a code, and hasn't been verified yet this session
        await connectDB()
        const freshUser = await User.findOne({ email: (user as any).email })
        token.hasIdentificationCode = !!freshUser?.identificationCode
        token.codeVerified = (user as any).codeVerified ?? !freshUser?.identificationCode
      }

      if (trigger === 'update' && session) {
        if (session.role) token.role = session.role
        if (session.image !== undefined) {
          token.picture = session.image && session.image.length <= 2048 ? session.image : null
        }
        if (session.codeVerified !== undefined) token.codeVerified = session.codeVerified // NEW
        return token
      }

      if (token.email) {
        await connectDB()
        const dbUser = await User.findOne({ email: token.email as string })
        if (dbUser) {
          token.id = dbUser._id.toString()
          token.role = dbUser.role ?? null
          token.picture = dbUser.image && dbUser.image.length <= 2048 ? dbUser.image : null
          token.jurisdictionCity = dbUser.jurisdictionCity ?? null
          token.jurisdictionState = dbUser.jurisdictionState ?? null
          token.hasIdentificationCode = !!dbUser.identificationCode // NEW
        }
      }

      return token
    },
    async session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = (token.role as any) ?? null
      session.user.image = (token.picture as string) ?? null
      session.user.jurisdictionCity = (token.jurisdictionCity as string) ?? null
      session.user.jurisdictionState = (token.jurisdictionState as string) ?? null
      session.user.codeVerified = (token.codeVerified as boolean) ?? true // NEW
      return session
    },
  },
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }