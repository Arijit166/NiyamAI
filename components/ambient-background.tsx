'use client'

import { useEffect } from 'react'

export function AmbientBackground() {
  useEffect(() => {
    const root = document.documentElement

    let ticking = false

    const updateAmbient = () => {
      const scrollHeight = document.documentElement.scrollHeight
      const viewportHeight = window.innerHeight
      const maxScroll = Math.max(scrollHeight - viewportHeight, 1)

      const progress = Math.min(window.scrollY / maxScroll, 1)

      /*
       * Move the ambient light sources as the user scrolls.
       * Values are deliberately subtle so the UI remains professional.
       */
      const x1 = 8 + progress * 55
      const y1 = 10 + progress * 35

      const x2 = 88 - progress * 48
      const y2 = 24 + progress * 58

      const x3 = 62 - progress * 35
      const y3 = 92 - progress * 48

      root.style.setProperty('--ambient-x1', `${x1}%`)
      root.style.setProperty('--ambient-y1', `${y1}%`)
      root.style.setProperty('--ambient-x2', `${x2}%`)
      root.style.setProperty('--ambient-y2', `${y2}%`)
      root.style.setProperty('--ambient-x3', `${x3}%`)
      root.style.setProperty('--ambient-y3', `${y3}%`)

      ticking = false
    }

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateAmbient)
        ticking = true
      }
    }

    updateAmbient()

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', updateAmbient)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', updateAmbient)
    }
  }, [])

  return (
    <div className="ambient-background" aria-hidden="true">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <div className="ambient-orb ambient-orb-three" />
    </div>
  )
}