'use client'

import { useSession } from 'next-auth/react'
import { MapPin } from 'lucide-react'

export function OfficerJurisdictionBadge() {
  const { data: session } = useSession()
  const city = session?.user?.jurisdictionCity
  const state = session?.user?.jurisdictionState
  if (!city) return null

  return (
    <div className="badge badge-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <MapPin size={12} />
      Jurisdiction: {city}{state ? `, ${state}` : ''}
    </div>
  )
}