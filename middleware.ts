import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup']

function isPublicPage(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function isPublicAuthRoute(pathname: string) {
  return pathname === '/api/auth/signup' || pathname.startsWith('/api/auth/signin') ||
    pathname.startsWith('/api/auth/callback') || pathname === '/api/auth/session' ||
    pathname === '/api/auth/csrf' || pathname === '/api/auth/providers' ||
    pathname.startsWith('/api/auth/signout')
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const isApiRoute = pathname.startsWith('/api/')
  const isPublic = isPublicPage(pathname) || isPublicAuthRoute(pathname)

  if (!token) {
    if (isApiRoute && !isPublic) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL('/login', req.url))
  }

  if (!token.role) {
    if (pathname === '/select-role') return NextResponse.next()
    if (pathname === '/api/auth/set-role') return NextResponse.next()
    if (isApiRoute) {
      return NextResponse.json({ error: 'A role must be selected.' }, { status: 403 })
    }
    return NextResponse.redirect(new URL('/select-role', req.url))
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