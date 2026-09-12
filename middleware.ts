import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/company-signup',]

function isPublicPage(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function isPublicAuthRoute(pathname: string) {
  return pathname === '/api/auth/signup' || pathname === '/api/auth/company-signup' || pathname.startsWith('/api/auth/signin') ||
    pathname.startsWith('/api/auth/callback') || pathname === '/api/auth/session' ||
    pathname === '/api/auth/csrf' || pathname === '/api/auth/providers' ||
    pathname.startsWith('/api/auth/signout') ||
    pathname === '/api/upload/id-proof' // NEW — needed mid-signup/select-role, before role/code checks pass
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }) as any
  const isApiRoute = pathname.startsWith('/api/')
  const isPublic = isPublicPage(pathname) || isPublicAuthRoute(pathname)

  if (!token) {
    if (isApiRoute && !isPublic) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL('/login', req.url))
  }

  if (!token.role) {
    // ADD — let session sync, upload, and other public auth plumbing through;
    // otherwise update() can never write the new role into the JWT cookie.
    if (isPublic) return NextResponse.next()

    if (pathname === '/select-role') return NextResponse.next()
    if (pathname.startsWith('/api/auth/set-role')) return NextResponse.next()
    if (isApiRoute) {
      return NextResponse.json({ error: 'A role must be selected.' }, { status: 403 })
    }
    return NextResponse.redirect(new URL('/select-role', req.url))
  }

  // NEW — officers with an identification code must verify it every session
  // before reaching anything else (this covers Google logins; credentials
  // logins already check the code inline during authorize()).
  const needsCodeCheck = token.hasIdentificationCode && !token.codeVerified
  const isVerifyCodePage = pathname === '/verify-code'
  const isVerifyCodeApi = pathname === '/api/auth/verify-code'

  if (needsCodeCheck) {
    if (isPublic) return NextResponse.next()
    if (isVerifyCodePage || isVerifyCodeApi) return NextResponse.next()
    if (isApiRoute) {
      return NextResponse.json({ error: 'Please verify your identification code first.' }, { status: 403 })
    }
    return NextResponse.redirect(new URL('/verify-code', req.url))
  }

  // once verified (or not required), don't let them linger on the verify page
  if (isVerifyCodePage && !needsCodeCheck) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  if (isPublicPage(pathname) || pathname === '/select-role') {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}