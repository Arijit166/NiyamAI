'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { AmbientBackground } from '@/components/ambient-background'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
      >
        <AmbientBackground />
        {children}
      </ThemeProvider>
    </SessionProvider>
  )
}