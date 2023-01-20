import { createRestManager } from '@discordeno/rest'
import { DISCORD_TOKEN } from './configs'

// export const DISCORD_TOKEN = ''

const rest = createRestManager({
  token: DISCORD_TOKEN,
})

rest.sendMessage('806947972004839444', { content: 'WHATEVER' })
