import { client } from './bot.js'
import { DEVELOPMENT } from './configs.js'
import { updateDevCommands } from './utils/commands.js'

export async function testing() {
  // const test = await Gamer.rest.sendMessage('806947972004839444', { content: 'Let me be ITOH!' })

  if (DEVELOPMENT) {
    console.info(`[DEV MODE] Updating slash commands for dev server.`)
    updateDevCommands()
  }

  console.log('[Gateway] Starting gateway')
  await client.connect()
  // await Gamer.gateway.spawnShards()
  console.log('[Gateway] Gateway started!')
  // console.log(test)
}

testing()
