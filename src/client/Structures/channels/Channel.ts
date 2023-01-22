import { ChannelTypes, type DiscordChannel } from '@discordeno/types'
import Base from '../../Base.js'
import type Client from '../../Client.js'
import type { AnyChannel } from '../../typings.js'
import { generateChannel } from '../../utils/generator.js'

export class Channel extends Base {
  type: ChannelTypes
  client: Client

  constructor(data: DiscordChannel | Pick<DiscordChannel, 'id' | 'permissions' | 'name' | 'type'>, client: Client) {
    super(data.id)
    this.type = data.type
    this.client = client
  }

  get mention(): string {
    return `<#${this.id}>`
  }

  /**
   * @deprecated Use generateChannel() instead
   * This was badly written code abusing circular imports.
   */
  static from(data: DiscordChannel, client: Client): Channel {
    client.emit('error', `Channel.from() is not working as previous. Please use generateChannel()`)
    return new Channel(data, client)
  }

  toJSON(props: string[] = []): Record<string, any> {
    return super.toJSON(['type', ...props])
  }
}

export default Channel
