/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { InteractionTypes, type BigString, type DiscordInteraction } from '@discordeno/types'
import Base from '../../Base.js'
import type Client from '../../Client.js'
import AutocompleteInteraction from './Autocomplete.js'
import CommandInteraction from './Command.js'
import ComponentInteraction from './Component.js'
import PingInteraction from './Ping.js'
import UnknownInteraction from './Unknown.js'

export class Interaction extends Base {
  client: Client
  applicationID: BigString
  token: string
  type: InteractionTypes
  version: 1
  acknowledged: boolean

  constructor(data: DiscordInteraction, client: Client) {
    super(data.id)
    this.client = client

    this.applicationID = data.application_id
    this.token = data.token
    this.type = data.type
    this.version = data.version
    this.acknowledged = false
  }

  /**
   * @deprecated Use `.client`
   */
  get _client(): Client {
    return this.client
  }

  update() {
    this.acknowledged = true
  }

  /**
   * @deprecated Use generateInteraction() instead
   * This was badly written code abusing circular imports.
   */
  static from(data: DiscordInteraction, client: Client) {
    client.emit('error', `Interaction.from() is not working as previous. Please use generateInteraction()`)
    return new Interaction(data, client)
  }
}

export default Interaction
