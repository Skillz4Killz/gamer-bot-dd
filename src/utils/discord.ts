import type { BigString } from '@discordeno/types'

export function snowflakeToTimestamp(snowflake: BigString) {
  return Number((BigInt(snowflake) >> 22n) + 1420070400000n)
}
