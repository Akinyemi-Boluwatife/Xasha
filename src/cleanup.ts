export async function cleanupExpired(db: D1Database): Promise<void> {
  // Bounded work per invocation; overlapping runs are safe.
  const cutoff = Date.now()
  try {
    for (let batch = 0; batch < 20; batch++) {
      const result = await db.prepare(
        'DELETE FROM secrets WHERE id IN (SELECT id FROM secrets WHERE expires_at <= ?1 ORDER BY expires_at LIMIT 500)',
      ).bind(cutoff).run()
      if (result.meta.changes < 500) return
    }
  } catch {
    // Let Cloudflare record a failed scheduled execution without sensitive SQL details.
    throw new Error('Expired secret cleanup failed.')
  }
}
