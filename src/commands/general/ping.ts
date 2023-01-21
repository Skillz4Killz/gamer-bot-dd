import { InteractionResponseTypes } from '@discordeno/types'

import { Gamer } from '../../bot.js'
import { translate } from '../../utils/translate.js'
import { createCommand } from '../createCommand.js'
import { snowflakeToTimestamp } from '../../utils/discord.js'

const command = createCommand({
  name: 'PING_NAME',
  description: 'PING_DESCRIPTION',
  execute: async function (interaction) {
    await Gamer.rest.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: translate(interaction.guildId!, 'PING_RESPONSE_WITH_TIME', Date.now() - snowflakeToTimestamp(interaction.id)),
      }
    })
  },
})

export default command
