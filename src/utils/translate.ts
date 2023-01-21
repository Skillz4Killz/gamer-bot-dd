import { BigString } from '@discordeno/types'

import { Gamer } from '../bot.js'
import { MISSING_TRANSLATION_WEBHOOK } from '../configs.js'
import languages from '../languages/index.js'
import english from '../languages/english.js'
import { BOT_DEV_IDS } from './constants/bot.js'
import { webhookURLToIDAndToken } from './hooks.js'

/** This should hold the language names per guild id. <guildId, language> */
export const serverLanguages = new Map<bigint, keyof typeof languages>()

export function translate<K extends translationKeys>(guildIdOrLanguage: BigString, key: K, ...params: getArgs<K>): string {
  const language = getLanguage(guildIdOrLanguage)
  let value: string | ((...any: any[]) => string) | string[] | undefined = languages[language]?.[key]

  // Was not able to be translated
  if (!value) {
    // Check if this key is available in english
    if (language !== 'english') {
      value = languages.english[key]
    }

    // Still not found in english so default to using the KEY_ITSELF
    if (!value) value = key

    // Send a log webhook so the devs know sth is missing
    missingTranslation(language, key)
  }

  if (Array.isArray(value)) return value.join('\n')

  if (typeof value === 'function') return value(...(params || []))

  return value
}

/** Get the language this guild has set, will always return "english" if it is not in cache */
export function getLanguage(guildIdOrLanguage: BigString) {
  return serverLanguages.get(BigInt(guildIdOrLanguage)) ?? 'english'
}

export async function loadLanguage(guildId: bigint) {
  // TODO: add this settings
  // const settings = await database.findOne('guilds', guildId)
  const settings = { language: 'undefined' }

  if (settings?.language && languages[settings.language]) {
    serverLanguages.set(guildId, settings.language)
  } else serverLanguages.set(guildId, 'english')
}

/** Send a webhook for a missing translation key */
export async function missingTranslation(language: keyof typeof languages, key: string) {
  if (!MISSING_TRANSLATION_WEBHOOK) return
  const { id, token } = webhookURLToIDAndToken(MISSING_TRANSLATION_WEBHOOK)
  if (!id || !token) return

  //   const embeds = new Embeds()
  //     .setTitle("Missing Translation")
  //     .setColor("RANDOM")
  //     .addField("Language", language, true)
  //     .addField("Key", key, true);

  await Gamer.rest
    .executeWebhook(id, token, {
      content: BOT_DEV_IDS.map(id => `<@${id}>`).join(' '),
      embeds: [
        {
          title: 'Missing Translation',
          fields: [
            {
              name: 'Language',
              value: language,
              inline: true,
            },
            {
              name: 'Key',
              value: key,
              inline: true,
            },
          ],
        },
      ],
      wait: false,
    })
    .catch(Gamer.logger.error)
}

// type translationKeys = keyof typeof english | string
export type translationKeys = keyof typeof english
type getArgs<K extends translationKeys> = typeof english[K] extends (...any: any[]) => unknown ? Parameters<typeof english[K]> : []
