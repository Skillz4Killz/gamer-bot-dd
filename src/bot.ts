import { createRestManager } from '@discordeno/rest'
import { DISCORD_TOKEN } from './configs.js'

export const Gamer = {
  // TODO: replace with logger
  logger: console,
  rest: createRestManager({
    token: DISCORD_TOKEN,
  }),
}
