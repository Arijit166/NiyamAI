import crypto from 'crypto'
import Invitation from '@/models/Invitation'
import User from '@/models/User'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I — avoids visual confusion

function randomSegment(len: number) {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/** NIYAM-XXXX-XXXX, guaranteed unique across pending invites + existing users */
export async function generateUniqueIdentificationCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `NIYAM-${randomSegment(4)}-${randomSegment(4)}`
    const [existingInvite, existingUser] = await Promise.all([
      Invitation.findOne({ identificationCode: code }),
      User.findOne({ identificationCode: code }),
    ])
    if (!existingInvite && !existingUser) return code
  }
  throw new Error('Failed to generate a unique identification code. Please try again.')
}