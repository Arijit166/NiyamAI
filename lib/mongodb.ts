import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI

declare global {
  // eslint-disable-next-line no-var
  var _mongooseConn: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined
}

const cached = global._mongooseConn ?? (global._mongooseConn = { conn: null, promise: null })

export async function connectDB() {
  if (cached.conn) return cached.conn

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Add it to your .env.local before calling connectDB().')
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI)
  }

  cached.conn = await cached.promise
  return cached.conn
}