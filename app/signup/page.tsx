import { Suspense } from 'react'
import { SignupPage } from '@/components/auth-pages'

export default function Page() {
  return (
    <Suspense>
      <SignupPage />
    </Suspense>
  )
}