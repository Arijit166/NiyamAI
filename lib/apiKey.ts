import crypto from 'crypto'

export function generateApiKey(prefix: string = 'NIYAM-CO') {
  return `${prefix}-${crypto.randomBytes(20).toString('hex').toUpperCase()}`
}