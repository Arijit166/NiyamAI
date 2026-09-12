/** Resolves an Indian city to its state via OpenStreetMap Nominatim.
 *  Throws instead of silently returning null, so callers can surface
 *  a real "invalid city" error. */
export async function resolveCityState(city: string): Promise<string> {
  const trimmed = city.trim()
  if (!trimmed) throw new Error('Please enter a jurisdiction city.')

  let results: any[] = []
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=in&q=${encodeURIComponent(trimmed)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'NiyamAI/1.0' } }
    )
    results = await geoRes.json()
  } catch {
    throw new Error('Could not verify that city right now. Please try again.')
  }

  const state = results?.[0]?.address?.state
  if (!results?.length || !state) {
    throw new Error('That does not look like a valid Indian city. Please check the spelling and try again.')
  }
  return state
}