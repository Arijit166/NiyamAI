'use client'

import NiyamAIApp from '@/components/niyam-ai-app'
import { ComplianceHeadApp } from '@/components/niyam-ai-app/compliance/ComplianceHeadApp'
import { ProductManagerApp } from '@/components/niyam-ai-app/compliance/ProductManagerApp'
import { useSession } from 'next-auth/react'

export default function Page() {
  const { data: session } = useSession()
  const role = session?.user?.role

  if (role === 'compliance_head') return <ComplianceHeadApp />
  if (role === 'product_manager') return <ProductManagerApp />

  return <NiyamAIApp />
}
