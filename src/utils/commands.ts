import { ApplicationCommandTypes, ApplicationCommandOption, BigString } from '@discordeno/types'
import type { ArgumentDefinition } from '../types/commands'

import { Gamer } from '../bot.js'
import { commands } from '../commands/index.js'
import { serverLanguages, translate } from './translate.js'

export async function updateDevCommands() {
  const guildId = '547046977578336286'

  // let characters =
  //   translate(bot, guildId, commands.roles.name).length + translate(bot, guildId, commands.roles.description).length

  // for (const option of commands.roles.options ?? []) {
  //   characters += translate(bot, guildId, option.name).length + translate(bot, guildId, option.description).length
  //   if (option.choices) {
  //     for (const choice of option.choices) {
  //       characters += translate(bot, guildId, choice.name).length + option.value.toString().length
  //     }
  //   }
  //   if (option.options) {
  //     for (const suboption of option.options) {
  //       characters +=
  //         translate(bot, guildId, suboption.name).length + translate(bot, guildId, suboption.description).length

  //       if (suboption.choices) {
  //         for (const choice of suboption.choices) {
  //           characters += translate(bot, guildId, choice.name).length + choice.value.toString().length
  //         }
  //       }

  //       if (suboption.options) {
  //         for (const subsuboption of suboption.options) {
  //           characters +=
  //             translate(bot, guildId, subsuboption.name).length + translate(bot, guildId, subsuboption.description).length

  //           if (subsuboption.choices) {
  //             for (const choice of subsuboption.choices) {
  //               characters += translate(bot, guildId, choice.name).length + choice.value.toString().length
  //             }
  //           }
  //         }
  //       }
  //     }

  //   }
  // }

  // console.log('CHAR#', translate(bot, guildId, commands.roles.name), characters)

  // if (characters) return

  const cmds = Object.entries(commands)
  // ONLY DEV COMMANDS
  // .filter(([_name, command]) => command?.dev)

  if (!cmds.length) return

  console.log('UPDATING DEV COMMANDS')

  // DEV RELATED COMMANDS
  await Gamer.rest.upsertGuildApplicationCommands(
    guildId,
    cmds.map(([name, command]) => {
      const translatedName = translate(guildId, command.name)
      const translatedDescription = command.description ? translate(guildId, command.description) : ''

      if (command.type && command.type !== ApplicationCommandTypes.ChatInput) {
        return {
          name: (translatedName || name).toLowerCase(),
          type: command.type,
        }
      }

      return {
        name: (translatedName || name).toLowerCase(),
        description: translatedDescription || command!.description,
        options: command.options ? createOptions(guildId, command.options, command.name) : undefined,
      }
    }),
  )
}

// USED TO CACHE CONVERTED COMMANDS AFTER START TO PREVENT UNNECESSARY LOOPS
const convertedCache = new Map<string, ApplicationCommandOption[]>()

/** Creates the commands options including subcommands. Also translates them. */
function createOptions(guildId: BigString | 'english', options: ArgumentDefinition[], commandName?: string): ApplicationCommandOption[] | undefined {
  const language = guildId === 'english' ? 'english' : serverLanguages.get(BigInt(guildId)) ?? 'english'
  if (commandName && convertedCache.has(`${language}-${commandName}`)) {
    return convertedCache.get(`${language}-${commandName}`)!
  }

  const newOptions: ApplicationCommandOption[] = []

  for (const option of options || []) {
    const optionName = translate(guildId, option.name)
    // @ts-ignore
    const optionDescription = translate(guildId, option.description)

    // TODO: remove this ts ignore
    // @ts-ignore
    const choices = option.choices?.map((choice) => ({
      ...choice,
      name: translate(guildId, choice.name),
    }))

    newOptions.push({
      ...option,
      name: optionName.toLowerCase(),
      description: optionDescription || 'No description available.',
      choices,
      // @ts-ignore fix this
      options: option.options
        ? // @ts-ignore fix this
          createOptions(bot, guildId, option.options)
        : undefined,
    })
  }
  if (commandName) convertedCache.set(`${language}-${commandName}`, newOptions)

  return newOptions
}
