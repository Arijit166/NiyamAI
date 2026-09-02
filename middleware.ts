import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (!token) {
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL('/login', req.url))
  }

  if (!token.role) {
    if (pathname === '/select-role') return NextResponse.next()
    return NextResponse.redirect(new URL('/select-role', req.url))
  }

  if (isPublic || pathname === '/select-role') {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/select-role',
    '/onboarding',
    '/dashboard',
    '/capture/:path*',
    '/analysis/:path*',
    '/analytics/:path*',
    '/commerce/:path*',
    '/evidence/:path*',
    '/extraction/:path*',
    '/history/:path*',
    '/inspection/:path*',
    '/manufacturers/:path*',
    '/package/:path*',
    '/products/:path*',
    '/profile/:path*',
    '/report/:path*',
    '/result/:path*',
    '/risk/:path*',
    '/rules/:path*',
  ],
}