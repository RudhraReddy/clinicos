import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')
  const pathname = request.nextUrl.pathname

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/create-account') ||
    pathname.startsWith('/connect') ||
    pathname.startsWith('/api')

  if (!isPublic && !token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect already-logged-in users away from login/create-account
  if ((pathname === '/login' || pathname === '/create-account') && token) {
    return NextResponse.redirect(new URL('/', request.url))
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
