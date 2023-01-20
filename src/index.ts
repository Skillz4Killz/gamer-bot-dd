import { Gamer } from './bot.js'
import { DEVELOPMENT } from './configs.js'
import { updateDevCommands } from './utils/commands.js'

export async function testing() {
  const test = await Gamer.rest.sendMessage('806947972004839444', { content: 'Let me be ITOH!' })

  for (let i = 0; i < 100; i++) {
    await Gamer.rest.sendMessage('806947972004839444', { content: 'Lit be knoen ITOH is the best(testing rate limiter)' + i + 'yui is amazing' })
  }

  if (DEVELOPMENT) {
    console.info(`[DEV MODE] Updating slash commands for dev server.`)
    updateDevCommands()
  }

  console.log(test)
}

testing()
