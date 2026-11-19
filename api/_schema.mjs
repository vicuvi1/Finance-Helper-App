// LT22: which database version this server was built for. It is the number
// of migrations in src/core/schema.ts (a test checks they match, so adding a
// migration means bumping this). Pages send theirs (X-Life-Schema); a page
// built before the newest change may still read, but /api/db refuses its
// writes with "A new version is out — please reload" until it reloads.
// Data migrations that MOVE data (not just add tables/columns) must run once
// on the server, never in each browser.
export const SCHEMA_VERSION = 25

/** True when a page says it was built for an older database than this server's. */
export function schemaTooOld(header, mine = SCHEMA_VERSION) {
  const n = Number(String(header ?? '').trim())
  return Number.isInteger(n) && n > 0 && n < mine
}
