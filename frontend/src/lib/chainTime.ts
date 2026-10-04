export function adjustToLocalClock(
  timestamp: number | bigint,
  latestBlockTimestamp: number | bigint,
  localNowMilliseconds = Date.now(),
): number {
  const clockOffset = Number(latestBlockTimestamp) - Math.floor(localNowMilliseconds / 1000)
  return Number(timestamp) - clockOffset
}
