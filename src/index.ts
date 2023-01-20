import { createRestManager } from '@discordeno/rest'
import { DISCORD_TOKEN } from './configs.js'

// export const DISCORD_TOKEN = ''

const rest = createRestManager({
  token: DISCORD_TOKEN,
})

export async function testing() {
    const test = await rest.sendMessage('806947972004839444', { content: 'Let me be ITOH!' })

    for (let i = 0; i < 100; i++) {
        await rest.sendMessage('806947972004839444', { content: 'Lit be knoen ITOH is the best(testing rate limiter)' + i + 'yui is amazing' })
    }
    console.log(test);
}

testing();
