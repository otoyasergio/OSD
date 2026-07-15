export function buildDmKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(":");
}
