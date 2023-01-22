/* eslint-disable no-useless-call */
/* eslint-disable no-prototype-builtins */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-dynamic-delete */
/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import {
  ChannelTypes,
  Camelize,
  Intents,
  type DiscordChannel,
  type DiscordChannelPinsUpdate,
  type DiscordGatewayPayload,
  type DiscordGuild,
  type DiscordGuildBanAddRemove,
  type DiscordGuildEmojisUpdate,
  type DiscordGuildMemberAdd,
  type DiscordGuildMemberRemove,
  type DiscordGuildMembersChunk,
  type DiscordGuildMemberUpdate,
  type DiscordGuildRoleCreate,
  type DiscordGuildRoleDelete,
  type DiscordGuildRoleUpdate,
  type DiscordHello,
  type DiscordInteraction,
  type DiscordInviteCreate,
  type DiscordInviteDelete,
  type DiscordMessage,
  type DiscordMessageDelete,
  type DiscordMessageDeleteBulk,
  type DiscordMessageReactionAdd,
  type DiscordMessageReactionRemove,
  type DiscordMessageReactionRemoveAll,
  type DiscordMessageReactionRemoveEmoji,
  type DiscordPresenceUpdate,
  type DiscordReady,
  type DiscordStageInstance,
  type DiscordThreadListSync,
  type DiscordThreadMembersUpdate,
  type DiscordTypingStart,
  type DiscordUnavailableGuild,
  type DiscordUser,
  type DiscordVoiceServerUpdate,
  type DiscordVoiceState,
  type DiscordWebhookUpdate,
} from '@discordeno/types'
import EventEmitter from 'events'
import Base from '../Base.js'
import type Client from '../Client.js'
import Channel from '../Structures/channels/Channel.js'
import GuildChannel from '../Structures/channels/Guild.js'
import PrivateChannel from '../Structures/channels/Private.js'
import type StageChannel from '../Structures/channels/Stage.js'
import type TextChannel from '../Structures/channels/Text.js'
import type TextVoiceChannel from '../Structures/channels/TextVoice.js'
import ThreadChannel from '../Structures/channels/threads/Thread.js'
import type VoiceChannel from '../Structures/channels/Voice.js'
import Guild from '../Structures/guilds/Guild.js'
import Member from '../Structures/guilds/Member.js'
import Role from '../Structures/guilds/Role.js'
import StageInstance from '../Structures/guilds/StageInstance.js'
import UnavailableGuild from '../Structures/guilds/Unavailable.js'
import Interaction from '../Structures/interactions/Interaction.js'
import Invite from '../Structures/Invite.js'
import Message from '../Structures/Message.js'
import ExtendedUser from '../Structures/users/Extended.js'
import User from '../Structures/users/User.js'
import type {
  ActivityPartial,
  BotActivityType,
  ClientPresence,
  RequestGuildMembersOptions,
  RequestMembersPromise,
  SelfStatus,
  TextableChannel,
} from '../typings.js'
import type BrowserWebSocket from '../utils/BrowserWebSocket.js'
import Bucket from '../utils/Bucket.js'
import { Shard as DiscordenoShard } from '../../gateway/Shard.js'

export class Shard extends EventEmitter {
  client: Client
  connectAttempts: number = 0
  connecting = false
  connectTimeout: number | null = null
  discordServerTrace?: string[]
  getAllUsersCount: { [guildID: string]: boolean } = {}
  getAllUsersLength: number = 0
  getAllUsersQueue: unknown[] = []
  globalBucket!: Bucket
  guildCreateTimeout: number | null = null
  guildSyncQueue: string[] = []
  guildSyncQueueLength: number = 0
  heartbeatInterval: number | null = null
  id: number
  lastHeartbeatAck = false
  lastHeartbeatReceived: number | null = null
  lastHeartbeatSent: number | null = null
  latency: number = 0
  preReady = false
  presence!: ClientPresence
  presenceUpdateBucket!: Bucket
  ready = false
  reconnectInterval: number = 0
  requestMembersPromise: { [s: string]: RequestMembersPromise } = {}
  seq: number = 0
  sessionID: string | null = null
  status: 'connecting' | 'disconnected' | 'handshaking' | 'identifying' | 'ready' | 'resuming' = 'disconnected'

  unsyncedGuilds: number = 0
  ws: WebSocket | BrowserWebSocket | null = null

  discordeno: DiscordenoShard

  constructor(id: number, client: Client) {
    super()

    this.id = id
    this.client = client

    this.onPacket = this.onPacket.bind(this)
    this._onWSOpen = this._onWSOpen.bind(this)
    this._onWSMessage = this._onWSMessage.bind(this)
    this._onWSError = this._onWSError.bind(this)
    this._onWSClose = this._onWSClose.bind(this)

    console.log('SHARD CONSTRUCTED')
    this.discordeno = new DiscordenoShard({
      id,
      connection: {
        compress: client.options.compress ?? false,
        intents: client.options.intents,
        properties: {
          browser: 'Discordeno',
          device: 'Discordeno',
          os: process.platform ?? 'Discordeno',
        },
        token: this.token,
        totalShards: client.options.maxShards === 'auto' ? 1 : client.options.maxShards,
        url: client.gatewayURL ?? 'wss://gateway.discord.gg',
        version: client.apiVersion ?? 10,
      },
      events: {
        message: (shard, payload) => {
          console.log('IN MESSAGE HERE', payload)
          // this._onWSMessage(payload)
          this.wsEvent(payload)
        },
      },
    })

    this.hardReset()
  }

  /**
   * @deprecated Use .token instead.
   */
  get _token(): string {
    return this.token
  }

  get token(): string {
    return this.client.token
  }

  checkReady() {
    if (!this.ready) {
      this.ready = true
      super.emit('ready')
    }
  }

  /** Tells the shard to connect */
  connect() {
    return this.discordeno.connect()
  }

  createGuild(guild: Guild) {
    this.client.guildShardMap[guild.id] = this.id
    this.client.guilds.set(guild.id, guild)

    return guild
  }

  /** Disconnects the shard */
  disconnect(options: { reconnect?: boolean | 'auto' } = {}, error?: Error) {
    this.discordeno.stopHeartbeating()

    try {
      if (options.reconnect && this.sessionID) {
        if (this.discordeno.socket?.readyState === WebSocket.OPEN) {
          this.discordeno.close(4901, 'Discordeno: reconnect')
        } else {
          this.emit('debug', `Terminating websocket (state: ${this.discordeno.socket?.readyState})`, this.id)
          this.discordeno.close(1000, `Terminating websocket (state: ${this.discordeno.socket?.readyState})`)
        }
      } else {
        this.discordeno.close(1000, 'Discordeno: normal')
      }
    } catch (err) {
      this.emit('error', err, this.id)
    }
    this.reset()

    if (error) {
      this.emit('error', error, this.id)
    }

    super.emit('disconnect', error)

    if (this.sessionID && this.connectAttempts >= this.client.options.maxResumeAttempts) {
      this.emit('debug', `Automatically invalidating session due to excessive resume attempts | Attempt ${this.connectAttempts}`, this.id)
      this.sessionID = null
    }

    if (options.reconnect === 'auto' && this.client.options.autoreconnect) {
      if (this.sessionID) {
        this.emit('debug', `Immediately reconnecting for potential resume | Attempt ${this.connectAttempts}`, this.id)
        this.client.shards.connect(this)
      } else {
        this.emit('debug', `Queueing reconnect in ${this.reconnectInterval}ms | Attempt ${this.connectAttempts}`, this.id)
        setTimeout(() => {
          this.client.shards.connect(this)
        }, this.reconnectInterval)
        this.reconnectInterval = Math.min(Math.round(this.reconnectInterval * (Math.random() * 2 + 1)), 30000)
      }
    } else if (!options.reconnect) {
      this.hardReset()
    }
  }

  /**
   * @deprecated user bot code
   * Update the bot's AFK status.
   */
  editAFK(afk: boolean) {}

  /**
   * Updates the bot's status on all guilds the shard is in
   */
  editStatus(status: SelfStatus, activities?: Array<ActivityPartial<BotActivityType>> | ActivityPartial<BotActivityType>) {}

  emit(event: string, ...args: any[]) {
    this.client.emit.call(this.client, event, ...args)
    if (event !== 'error' || this.listeners('error').length > 0) {
      super.emit.call(this, event, ...args)
    }

    return false
  }

  getGuildMembers(guildID: string, timeout: number) {}

  hardReset() {}

  heartbeat(normal?: boolean) {
    this.discordeno.stopHeartbeating()
    this.discordeno.startHeartbeating(this.discordeno.heart.interval)
  }

  identify() {
    this.discordeno.identify()
  }

  initializeWS() {}

  onPacket(packet: DiscordGatewayPayload) {}

  async requestGuildMembers(guildID: string, options?: RequestGuildMembersOptions) {}

  reset() {}

  restartGuildCreateTimeout() {}

  resume() {
    this.discordeno.resume()
  }

  sendStatusUpdate() {}

  sendWS(op: number, _data: Record<string, unknown> | number, priority = false) {
    this.discordeno.send(
      {
        op,
        d: _data,
      },
      priority,
    )
  }

  wsEvent(pkt: Required<Camelize<DiscordGatewayPayload>>) {
    switch (pkt.t) {
      case 'PRESENCE_UPDATE': {
        const packet = pkt.d as Camelize<DiscordPresenceUpdate>

        if (packet.user.username !== undefined) {
          const oldUser = this.client.users.get(packet.user.id)
          const user = new User(packet.user, this.client)
          this.client.users.set(user.id, user)

          this.emit('userUpdate', user, oldUser)
        }

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('debug', 'Rogue presence update: ' + JSON.stringify(packet), this.id)
          break
        }

        // // @ts-expect-error js hacks
        // const oldMember = guild.members.get((packet.id = packet.user.id))
        // const member = new Member(packet, guild, this.client)
        // this.emit('presenceUpdate', member, {
        //   activities: oldMember.activities,
        //   clientStatus: oldMember.clientStatus,
        //   status: oldMember.status,
        // })

        // let member = guild.members.get((packet.id = packet.user.id))
        // let oldPresence = null
        // if (member) {
        //   oldPresence = {
        //     activities: member.activities,
        //     clientStatus: member.clientStatus,
        //     status: member.status,
        //   }
        // }
        // if ((!member && packet.user.username) || oldPresence) {
        //   member = guild.members.update(packet.d, guild)
        //   this.emit('presenceUpdate', member, oldPresence)
        // }
        break
      }
      case 'VOICE_STATE_UPDATE': {
        const packet = pkt.d as Camelize<DiscordVoiceState>

        // (╯°□°）╯︵ ┻━┻
        if (packet.guildId && packet.userId === this.client.id) {
          const voiceConnection = this.client.voiceConnections.get(packet.guildId)
          if (voiceConnection) {
            if (packet.channelId === null) {
              this.client.voiceConnections.leave(packet.guildId)
            } else if (voiceConnection.channelID !== packet.channelId) {
              voiceConnection.switchChannel(packet.channelId, true)
            }
          }
        }
        if (packet.selfStream === undefined) {
          packet.selfStream = false
        }

        const guild = this.client.guilds.get(packet.guildId!)
        if (!guild) {
          break
        }
        if (guild.pendingVoiceStates) {
          guild.pendingVoiceStates.push(packet)
          break
        }
        let member = guild.members.get((packet.id = packet.userId))
        if (!member) {
          if (!packet.member) {
            this.emit(
              'voiceStateUpdate',
              {
                id: packet.userId,
                voiceState: {
                  deaf: packet.deaf,
                  mute: packet.mute,
                  selfDeaf: packet.selfDeaf,
                  selfMute: packet.selfMute,
                  selfStream: packet.selfStream,
                  selfVideo: packet.selfVideo,
                },
              },
              null,
            )
            break
          }
          // Updates the member cache with this member for future events.
          packet.member.id = packet.userId
          member = new Member(packet.member, guild, this.client)
          guild.members.set(packet.userId, member)

          const channel = guild.channels.find(
            (channel) =>
              (channel.type === ChannelTypes.GuildVoice || channel.type === ChannelTypes.GuildStageVoice) && channel.voiceMembers.get(packet.id),
          )
          if (channel) {
            channel.voiceMembers.remove(packet)
            this.emit('debug', 'VOICE_STATE_UPDATE member null but in channel: ' + packet.id, this.id)
          }
        }
        const oldState = {
          deaf: member.voiceState?.deaf,
          mute: member.voiceState?.mute,
          selfDeaf: member.voiceState?.selfDeaf,
          selfMute: member.voiceState?.selfMute,
          selfStream: member.voiceState?.selfStream,
          selfVideo: member.voiceState?.selfVideo,
        }
        const oldChannelID = member.voiceState?.channelID
        member.update(packet)
        if (oldChannelID !== packet.channelId) {
          let oldChannel: TextVoiceChannel | StageChannel | null, newChannel: TextVoiceChannel | StageChannel | null
          if (oldChannelID) {
            oldChannel = guild.channels.get(oldChannelID) as TextVoiceChannel | StageChannel
            if (oldChannel && oldChannel.type !== ChannelTypes.GuildVoice && oldChannel.type !== ChannelTypes.GuildStageVoice) {
              this.emit('warn', 'Old channel not a recognized voice channel: ' + oldChannelID, this.id)
              oldChannel = null
            }
          }
          if (
            packet.channelId &&
            (newChannel = guild.channels.get(packet.channelId) as TextVoiceChannel | StageChannel) &&
            (newChannel.type === ChannelTypes.GuildVoice || newChannel.type === ChannelTypes.GuildStageVoice)
          ) {
            // Welcome to Discord, where one can "join" text channels
            if (oldChannel!) {
              oldChannel.voiceMembers.remove(member)
              this.emit('voiceChannelSwitch', newChannel.voiceMembers.add(member, guild), newChannel, oldChannel)
            } else {
              this.emit('voiceChannelJoin', newChannel.voiceMembers.add(member, guild), newChannel)
            }
          } else if (oldChannel!) {
            oldChannel.voiceMembers.remove(member)
            this.emit('voiceChannelLeave', member, oldChannel)
          }
        }
        if (
          oldState.mute !== member.voiceState?.mute ||
          oldState.deaf !== member.voiceState?.deaf ||
          oldState.selfMute !== member.voiceState?.selfMute ||
          oldState.selfDeaf !== member.voiceState?.selfDeaf ||
          oldState.selfStream !== member.voiceState?.selfStream ||
          oldState.selfVideo !== member.voiceState?.selfVideo
        ) {
          this.emit('voiceStateUpdate', member, oldState)
        }
        break
      }
      case 'TYPING_START': {
        const packet = pkt.d as Camelize<DiscordTypingStart>

        let member = null
        const guild = this.client.guilds.get(packet.guildId ?? '')
        if (guild) {
          member = guild.members.update(new Member({ ...packet.member!, id: packet.userId }, guild, this.client))
        }
        if (this.client.listeners('typingStart').length > 0) {
          this.emit(
            'typingStart',
            this.client.getChannel(packet.channelId) ?? {
              id: packet.channelId,
            },
            this.client.users.get(packet.userId) ?? { id: packet.userId },
            member,
          )
        }
        break
      }
      case 'MESSAGE_CREATE': {
        const packet = pkt.d as Camelize<DiscordMessage>

        const channel = this.client.getChannel(packet.channelId)
        if (channel) {
          // MESSAGE_CREATE just when deleting o.o
          channel.lastMessageID = packet.id

          this.emit('messageCreate', channel.messages.add(new Message(packet.d, this.client)))
        } else {
          this.emit('messageCreate', new Message(packet.d, this.client))
        }
        break
      }
      case 'MESSAGE_UPDATE': {
        const packet = pkt.d as Camelize<DiscordMessage>

        const channel = this.client.getChannel(packet.channelId)
        if (!channel) {
          packet.channel = {
            id: packet.channelId,
          }
          this.emit('messageUpdate', packet.d, null)
          break
        }
        const message = channel.messages.get(packet.id)
        let oldMessage = null
        if (message) {
          oldMessage = {
            attachments: message.attachments,
            channelMentions: message.channelMentions,
            content: message.content,
            editedTimestamp: message.editedTimestamp,
            embeds: message.embeds,
            flags: message.flags,
            mentionedBy: message.mentionedBy,
            mentions: message.mentions,
            pinned: message.pinned,
            roleMentions: message.roleMentions,
            tts: message.tts,
          }
        } else if (!packet.timestamp) {
          packet.channel = channel
          this.emit('messageUpdate', packet.d, null)
          break
        }
        this.emit('messageUpdate', channel.messages.update(new Message(packet.d, this.client)), oldMessage)
        break
      }
      case 'MESSAGE_DELETE': {
        const packet = pkt.d as Camelize<DiscordMessageDelete>

        const channel = this.client.getChannel(packet.channelId)

        this.emit(
          'messageDelete',
          channel?.messages.remove(new Message(packet.d, this.client)) || {
            id: packet.id,
            channel: channel ?? {
              id: packet.channelId,
              guild: packet.guildId ? { id: packet.guildId } : undefined,
            },
            guildID: packet.guildId,
          },
        )
        break
      }
      case 'MESSAGE_DELETE_BULK': {
        const packet = pkt.d as Camelize<DiscordMessageDeleteBulk>

        const channel = this.client.getChannel(packet.channelId)

        this.emit(
          'messageDeleteBulk',
          packet.ids.map(
            (id) =>
              channel?.messages.remove({
                id,
              }) || {
                id,
                channel: {
                  id: packet.channelId,
                  guild: packet.guildId ? { id: packet.guildId } : undefined,
                },
                guildID: packet.guildId,
              },
          ),
        )
        break
      }
      case 'MESSAGE_REACTION_ADD': {
        const packet = pkt.d as Camelize<DiscordMessageReactionAdd>

        const channel = this.client.getChannel(packet.channelId)
        let message:
          | Message
          | {
              id: string
              channel: TextableChannel | { id: string }
              guildID?: string
            }
          | undefined
        let member
        if (channel) {
          message = channel.messages.get(packet.messageId)
          if (channel.guild) {
            if (packet.member) {
              // Updates the member cache with this member for future events.
              packet.member.id = packet.userId
              member = channel.guild.members.update(packet.member, channel.guild)
            }
          }
        }
        if (message instanceof Message) {
          const reaction = packet.emoji.id ? `${packet.emoji.name}:${packet.emoji.id}` : packet.emoji.name!
          if (message.reactions[reaction]) {
            ++message.reactions[reaction].count
            if (packet.userId === this.client.id) {
              message.reactions[reaction].me = true
            }
          } else {
            message.reactions[reaction] = {
              count: 1,
              me: packet.userId === this.client.id,
            }
          }
        } else {
          message = {
            id: packet.messageId,
            channel: channel ?? { id: packet.channelId },
          }

          if (packet.guildId) {
            message.guildID = packet.guildId
            if (!message.channel.guild) {
              message.channel.guild = { id: packet.guildId }
            }
          }
        }
        this.emit('messageReactionAdd', message, packet.emoji, member || { id: packet.userId })
        break
      }
      case 'MESSAGE_REACTION_REMOVE': {
        const packet = pkt.d as Camelize<DiscordMessageReactionRemove>

        const channel = this.client.getChannel(packet.channelId)
        let message:
          | Message
          | {
              id: string
              channel: TextableChannel | { id: string }
              guildID?: string
            }
          | undefined
        if (channel) {
          message = channel.messages.get(packet.messageId)
        }
        if (message instanceof Message) {
          const reaction = packet.emoji.id ? `${packet.emoji.name}:${packet.emoji.id}` : packet.emoji.name!
          const reactionObj = message.reactions[reaction]
          if (reactionObj) {
            --reactionObj.count
            if (reactionObj.count === 0) {
              delete message.reactions[reaction]
            } else if (packet.userId === this.client.id) {
              reactionObj.me = false
            }
          }
        } else {
          message = {
            id: packet.messageId,
            channel: channel ?? { id: packet.channelId },
          }

          if (packet.guildId) {
            message.guildID = packet.guildId
            if (!message.channel.guild) {
              message.channel.guild = { id: packet.guildId }
            }
          }
        }

        this.emit('messageReactionRemove', message, packet.emoji, packet.userId)
        break
      }
      case 'MESSAGE_REACTION_REMOVE_ALL': {
        const packet = pkt.d as Camelize<DiscordMessageReactionRemoveAll>

        const channel = this.client.getChannel(packet.channelId)
        let message
        if (channel) {
          message = channel.messages.get(packet.messageId)
          if (message) {
            message.reactions = {}
          }
        }
        if (!message) {
          message = {
            id: packet.messageId,
            channel: channel ?? { id: packet.channelId },
          }
          if (packet.guildId) {
            message.guildID = packet.guildId
            if (!message.channel.guild) {
              message.channel.guild = { id: packet.guildId }
            }
          }
        }

        this.emit('messageReactionRemoveAll', message)
        break
      }
      case 'MESSAGE_REACTION_REMOVE_EMOJI': {
        const packet = pkt.d as Camelize<DiscordMessageReactionRemoveEmoji>

        const channel = this.client.getChannel(packet.channelId)
        let message
        if (channel) {
          message = channel.messages.get(packet.messageId)
          if (message) {
            const reaction = packet.emoji.id ? `${packet.emoji.name}:${packet.emoji.id}` : packet.emoji.name!
            delete message.reactions[reaction]
          }
        }
        if (!message) {
          message = {
            id: packet.messageId,
            channel: channel ?? { id: packet.channelId },
          }
          if (packet.guildId) {
            message.guildID = packet.guildId
            if (!message.channel.guild) {
              message.channel.guild = { id: packet.guildId }
            }
          }
        }

        this.emit('messageReactionRemoveEmoji', message, packet.emoji)
        break
      }
      case 'GUILD_MEMBER_ADD': {
        const packet = pkt.d as Camelize<DiscordGuildMemberAdd>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          // Eventual Consistency™ (╯°□°）╯︵ ┻━┻
          this.emit('debug', `Missing guild ${packet.guildId} in GUILD_MEMBER_ADD`)
          break
        }
        packet.id = packet.user.id
        guild.memberCount = (guild.memberCount ?? 0) + 1

        this.emit('guildMemberAdd', guild, guild.members.add(new Member(packet.d, guild, this.client)))
        break
      }
      case 'GUILD_MEMBER_UPDATE': {
        const packet = pkt.d as Camelize<DiscordGuildMemberUpdate>

        // Check for member update if GuildPresences intent isn't set, to prevent emitting twice
        if (!(this.client.options.intents & Intents.GuildPresences) && packet.user.username !== undefined) {
          let user = this.client.users.get(packet.user.id)
          let oldUser = null
          if (
            user &&
            (user.username !== packet.user.username || user.discriminator !== packet.user.discriminator || user.avatar !== packet.user.avatar)
          ) {
            oldUser = {
              username: user.username,
              discriminator: user.discriminator,
              avatar: user.avatar,
            }
          }
          if (!user || oldUser) {
            user = this.client.users.update(new User(packet.user, this.client))
            this.emit('userUpdate', user, oldUser)
          }
        }
        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in GUILD_MEMBER_UPDATE`)
          break
        }
        let member = guild.members.get((packet.id = packet.user.id))
        let oldMember = null
        if (member) {
          oldMember = {
            avatar: member.avatar,
            communicationDisabledUntil: member.communicationDisabledUntil,
            roles: member.roles,
            nick: member.nick,
            premiumSince: member.premiumSince,
            pending: member.pending,
          }
        }
        member = guild.members.update(new Member(packet.d, guild, this.client))

        this.emit('guildMemberUpdate', guild, member, oldMember)
        break
      }
      case 'GUILD_MEMBER_REMOVE': {
        const packet = pkt.d as Camelize<DiscordGuildMemberRemove>

        if (packet.user.id === this.client.id) {
          // The bot is probably leaving
          break
        }
        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          break
        }
        guild.memberCount = (guild.memberCount ?? 0) - 1
        packet.id = packet.user.id

        this.emit(
          'guildMemberRemove',
          guild,
          guild.members.remove(new Member(packet.d, guild, this.client)) ?? {
            id: packet.id,
            user: new User(packet.user, this.client),
          },
        )
        break
      }
      case 'GUILD_CREATE': {
        const packet = pkt.d as Camelize<DiscordGuild>

        if (!packet.unavailable) {
          const guild = this.createGuild(new Guild(packet.d, this.client))
          if (this.ready) {
            if (this.client.unavailableGuilds.remove(new Guild(packet.d, this.client))) {
              this.emit('guildAvailable', guild)
            } else {
              this.emit('guildCreate', guild)
            }
          } else {
            this.client.unavailableGuilds.remove(new Guild(packet.d, this.client))
            this.restartGuildCreateTimeout()
          }
        } else {
          this.client.guilds.remove(new Guild(packet.d, this.client))

          this.emit('unavailableGuildCreate', this.client.unavailableGuilds.add(new UnavailableGuild(packet.d, this.client)))
        }
        break
      }
      case 'GUILD_UPDATE': {
        const packet = pkt.d as Camelize<DiscordGuild>

        const guild = this.client.guilds.get(packet.id)
        if (!guild) {
          this.emit('debug', `Guild ${packet.id} undefined in GUILD_UPDATE`)
          break
        }
        const oldGuild = {
          afkChannelID: guild.afkChannelID,
          afkTimeout: guild.afkTimeout,
          banner: guild.banner,
          defaultNotifications: guild.defaultNotifications,
          description: guild.description,
          discoverySplash: guild.discoverySplash,
          emojis: guild.emojis,
          explicitContentFilter: guild.explicitContentFilter,
          features: guild.features,
          icon: guild.icon,
          large: guild.large,
          maxMembers: guild.maxMembers,
          maxVideoChannelUsers: guild.maxVideoChannelUsers,
          mfaLevel: guild.mfaLevel,
          name: guild.name,
          nsfw: guild.nsfw,
          nsfwLevel: guild.nsfwLevel,
          ownerID: guild.ownerID,
          preferredLocale: guild.preferredLocale,
          premiumSubscriptionCount: guild.premiumSubscriptionCount,
          premiumTier: guild.premiumTier,
          publicUpdatesChannelID: guild.publicUpdatesChannelID,
          rulesChannelID: guild.rulesChannelID,
          splash: guild.splash,
          stickers: guild.stickers,
          systemChannelFlags: guild.systemChannelFlags,
          systemChannelID: guild.systemChannelID,
          vanityURL: guild.vanityURL,
          verificationLevel: guild.verificationLevel,
        }

        this.emit('guildUpdate', this.client.guilds.update(new Guild(packet.d, this.client)), oldGuild)
        break
      }
      case 'GUILD_DELETE': {
        const packet = pkt.d as Camelize<DiscordUnavailableGuild>

        const voiceConnection = this.client.voiceConnections.get(packet.id)
        if (voiceConnection) {
          if (voiceConnection.channelID) {
            this.client.leaveVoiceChannel(voiceConnection.channelID)
          } else {
            this.client.voiceConnections.leave(packet.id)
          }
        }

        delete this.client.guildShardMap[packet.id]
        const guild = this.client.guilds.remove(packet.d)
        if (guild) {
          // Discord sends GUILD_DELETE for guilds that were previously unavailable in READY
          guild.channels.forEach((channel) => {
            delete this.client.channelGuildMap[channel.id]
          })
        }
        if (packet.unavailable) {
          this.emit('guildUnavailable', this.client.unavailableGuilds.add(new UnavailableGuild(packet.d, this.client)))
        } else {
          this.emit(
            'guildDelete',
            guild ?? {
              id: packet.id,
            },
          )
        }
        break
      }
      case 'GUILD_BAN_ADD': {
        const packet = pkt.d as Camelize<DiscordGuildBanAddRemove>

        this.emit('guildBanAdd', this.client.guilds.get(packet.guildId), this.client.users.update(new User(packet.user, this.client)))
        break
      }
      case 'GUILD_BAN_REMOVE': {
        const packet = pkt.d as Camelize<DiscordGuildBanAddRemove>

        this.emit('guildBanRemove', this.client.guilds.get(packet.guildId), this.client.users.update(new User(packet.user, this.client)))
        break
      }
      case 'GUILD_ROLE_CREATE': {
        const packet = pkt.d as Camelize<DiscordGuildRoleCreate>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in GUILD_ROLE_CREATE`)
          break
        }
        this.emit('guildRoleCreate', guild, guild.roles.add(new Role(packet.role, guild)))
        break
      }
      case 'GUILD_ROLE_UPDATE': {
        const packet = pkt.d as Camelize<DiscordGuildRoleUpdate>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('debug', `Guild ${packet.guildId} undefined in GUILD_ROLE_UPDATE`)
          break
        }
        const role = new Role(packet.role, guild)
        guild.roles.set(role.id, role)
        if (!role) {
          this.emit('debug', `Role ${packet.role.id} in guild ${packet.guildId} undefined in GUILD_ROLE_UPDATE`)
          break
        }
        const oldRole = {
          color: role.color,
          hoist: role.hoist,
          icon: role.icon,
          managed: role.managed,
          mentionable: role.mentionable,
          name: role.name,
          permissions: role.permissions,
          position: role.position,
          tags: role.tags,
          unicodeEmoji: role.unicodeEmoji,
        }

        this.emit('guildRoleUpdate', guild, guild.roles.update(new Role(packet.role, guild)), oldRole)
        break
      }
      case 'GUILD_ROLE_DELETE': {
        const packet = pkt.d as Camelize<DiscordGuildRoleDelete>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in GUILD_ROLE_DELETE`)
          break
        }
        if (!guild.roles.has(packet.roleId)) {
          this.emit('debug', `Missing role ${packet.roleId} in GUILD_ROLE_DELETE`)
          break
        }
        this.emit('guildRoleDelete', guild, guild.roles.remove({ id: packet.roleId }))
        break
      }
      case 'INVITE_CREATE': {
        const packet = pkt.d as Camelize<DiscordInviteCreate>

        const guild = this.client.guilds.get(packet.guildId ?? '')
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in INVITE_CREATE`)
          break
        }
        const channel = this.client.getChannel(packet.channelId)
        if (!channel) {
          this.emit('debug', `Missing channel ${packet.channelId} in INVITE_CREATE`)
          break
        }

        this.emit(
          'inviteCreate',
          guild,
          new Invite(
            {
              ...packet.d,
              guild,
              channel,
            },
            this.client,
          ),
        )
        break
      }
      case 'INVITE_DELETE': {
        const packet = pkt.d as Camelize<DiscordInviteDelete>

        const guild = this.client.guilds.get(packet.guildId ?? '')
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in INVITE_DELETE`)
          break
        }
        const channel = this.client.getChannel(packet.channelId)
        if (!channel) {
          this.emit('debug', `Missing channel ${packet.channelId} in INVITE_DELETE`)
          break
        }

        this.emit(
          'inviteDelete',
          guild,
          new Invite(
            {
              ...packet.d,
              guild,
              channel,
            },
            this.client,
          ),
        )
        break
      }
      case 'CHANNEL_CREATE': {
        const packet = pkt.d as Camelize<DiscordChannel>

        const channel = Channel.from(packet.d, this.client)
        if (packet.guildId) {
          if (!channel.guild) {
            channel.guild = this.client.guilds.get(packet.guildId)
            if (!channel.guild) {
              this.emit('debug', `Received CHANNEL_CREATE for channel in missing guild ${packet.guildId}`)
              break
            }
          }
          channel.guild.channels.add(channel, this.client)
          this.client.channelGuildMap[packet.id] = packet.guildId

          this.emit('channelCreate', channel)
        } else {
          this.emit('warn', new Error('Unhandled CHANNEL_CREATE type: ' + JSON.stringify(packet, null, 2)))
          break
        }
        break
      }
      case 'CHANNEL_UPDATE': {
        const packet = pkt.d as Camelize<DiscordChannel>

        let channel = this.client.getChannel(packet.id) as GuildChannel
        if (!channel) {
          break
        }
        let oldChannel
        const oldType = channel.type

        if (channel instanceof GuildChannel) {
          oldChannel = {
            bitrate: (channel as VoiceChannel).bitrate,
            name: channel.name,
            nsfw: channel.nsfw,
            parentID: channel.parentID,
            permissionOverwrites: channel.permissionOverwrites,
            position: channel.position,
            rateLimitPerUser: (channel as TextChannel).rateLimitPerUser,
            rtcRegion: (channel as VoiceChannel).rtcRegion,
            topic: (channel as TextChannel).topic,
            type: channel.type,
            userLimit: (channel as VoiceChannel).userLimit,
            videoQualityMode: (channel as VoiceChannel).videoQualityMode,
          }
        } else {
          this.emit('warn', `Unexpected CHANNEL_UPDATE for channel ${packet.id} with type ${oldType}`)
        }
        if (oldType === packet.type) {
          channel.update(packet.d)
        } else {
          this.emit('debug', `Channel ${packet.id} changed from type ${oldType} to ${packet.type}`)
          const newChannel = Channel.from(packet.d, this.client) as GuildChannel
          if (packet.guildId) {
            const guild = this.client.guilds.get(packet.guildId)
            if (!guild) {
              this.emit('debug', `Received CHANNEL_UPDATE for channel in missing guild ${packet.guildId}`)
              break
            }
            guild.channels.remove(channel)
            guild.channels.add(newChannel, this.client)
          } else if (channel instanceof PrivateChannel) {
            this.client.privateChannels.remove(channel)
            this.client.privateChannels.add(newChannel as unknown as PrivateChannel, this.client)
          } else {
            this.emit('warn', new Error('Unhandled CHANNEL_UPDATE type: ' + JSON.stringify(packet, null, 2)))
            break
          }
          channel = newChannel
        }

        this.emit('channelUpdate', channel, oldChannel)
        break
      }
      case 'CHANNEL_DELETE': {
        const packet = pkt.d as Camelize<DiscordChannel>

        if (packet.type === ChannelTypes.DM || packet.type === undefined) {
          if (this.id === 0) {
            const channel = this.client.privateChannels.remove(new PrivateChannel(packet.d, this.client))
            if (channel) {
              delete this.client.privateChannelMap[channel.recipient?.id ?? '']

              this.emit('channelDelete', channel)
            }
          }
        } else if (packet.guildId) {
          delete this.client.channelGuildMap[packet.id]
          const guild = this.client.guilds.get(packet.guildId)
          if (!guild) {
            this.emit('debug', `Missing guild ${packet.guildId} in CHANNEL_DELETE`)
            break
          }
          const channel = guild.channels.remove(new GuildChannel(packet.d, this.client))
          if (!channel) {
            break
          }
          if (channel.type === ChannelTypes.GuildVoice || channel.type === ChannelTypes.GuildStageVoice) {
            channel.voiceMembers.forEach((member) => {
              channel.voiceMembers.remove(member)
              this.emit('voiceChannelLeave', member, channel)
            })
          }
          this.emit('channelDelete', channel)
        } else {
          this.emit('warn', new Error('Unhandled CHANNEL_DELETE type: ' + JSON.stringify(packet, null, 2)))
        }
        break
      }
      case 'GUILD_MEMBERS_CHUNK': {
        const packet = pkt.d as Camelize<DiscordGuildMembersChunk>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit(
            'debug',
            `Received GUILD_MEMBERS_CHUNK, but guild ${packet.guildId} is ` +
              (this.client.unavailableGuilds.has(packet.guildId) ? 'unavailable' : 'missing'),
            this.id,
          )
          break
        }

        const members = packet.members.map((member) => {
          member.id = member.user.id
          return guild.members.add(new Member(member, guild, this.client))
        })

        if (packet.presences) {
          packet.presences.forEach((presence) => {
            const member = guild.members.get(presence.user.id)
            if (member) {
              member.update(presence)
            }
          })
        }

        if (this.requestMembersPromise.hasOwnProperty(packet.nonce ?? '')) {
          this.requestMembersPromise[packet.nonce ?? ''].members.push(...members)
        }

        if (packet.chunkIndex >= packet.chunkCount - 1) {
          if (this.requestMembersPromise.hasOwnProperty(packet.nonce ?? '')) {
            clearTimeout(this.requestMembersPromise[packet.nonce ?? ''].timeout)
            this.requestMembersPromise[packet.nonce ?? ''].res(this.requestMembersPromise[packet.nonce ?? ''].members)
            delete this.requestMembersPromise[packet.nonce ?? '']
          }
          if (this.getAllUsersCount.hasOwnProperty(guild.id)) {
            delete this.getAllUsersCount[guild.id]
            this.checkReady()
          }
        }

        this.emit('guildMemberChunk', guild, members)

        this.lastHeartbeatAck = true

        break
      }
      case 'RESUMED':
      case 'READY': {
        const packet = pkt.d as Camelize<DiscordReady>

        this.connectAttempts = 0
        this.reconnectInterval = 1000

        this.connecting = false
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout)
        }
        this.connectTimeout = null
        this.status = 'ready'
        this.presence.status = 'online'
        this.client.shards._readyPacketCB(this.id)

        if (packet.t === 'RESUMED') {
          // Can only heartbeat after resume succeeds, discord/discord-api-docs#1619
          this.heartbeat()

          this.preReady = true
          this.ready = true

          /**
           * Fired when a shard finishes resuming
           * @event Shard#resume
           */
          super.emit('resume')
          break
        }

        this.client.user = this.client.users.update(new ExtendedUser(packet.user, this.client), this.client)

        if (!this.client.token.startsWith('Bot ')) {
          this.client.token = 'Bot ' + this.client.token
        }

        if (packet._trace) {
          this.discordServerTrace = packet._trace
        }

        this.sessionID = packet.sessionId

        packet.guilds.forEach((guild) => {
          if (guild.unavailable) {
            this.client.guilds.delete(guild.id)
            this.client.unavailableGuilds.set(guild.id, new UnavailableGuild(guild, this.client))
          } else {
            this.client.unavailableGuilds.remove(this.createGuild(guild))
          }
        })

        this.client.application = packet.application

        this.preReady = true

        this.emit('shardPreReady', this.id)

        if (this.client.unavailableGuilds.size > 0 && packet.guilds.length > 0) {
          this.restartGuildCreateTimeout()
        } else {
          this.checkReady()
        }

        break
      }
      case 'VOICE_SERVER_UPDATE': {
        const packet = pkt.d as Camelize<DiscordVoiceServerUpdate>

        packet.sessionId = this.sessionID
        packet.userId = this.client.id
        packet.shard = this

        this.client.voiceConnections.voiceServerUpdate(packet.d)

        break
      }
      case 'USER_UPDATE': {
        const packet = pkt.d as Camelize<DiscordUser>

        let user = this.client.users.get(packet.id)
        let oldUser = null
        if (user) {
          oldUser = {
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
          }
        }
        user = this.client.users.update(new User(packet.d, this.client))
        this.emit('userUpdate', user, oldUser)
        break
      }
      case 'GUILD_EMOJIS_UPDATE': {
        const packet = pkt.d as Camelize<DiscordGuildEmojisUpdate>

        const guild = this.client.guilds.get(packet.guildId)
        let oldEmojis = null
        let emojis = packet.emojis
        if (guild) {
          oldEmojis = guild.emojis
          guild.update(packet.d)
          emojis = guild.emojis
        }

        this.emit('guildEmojisUpdate', guild ?? { id: packet.guildId }, emojis, oldEmojis)
        break
      }
      // TODO: Add this when dd has the support for this event
      // case 'GUILD_STICKERS_UPDATE': {

      // const guild = this.client.guilds.get(packet.guildId);
      // let oldStickers = null;
      // let stickers = packet.stickers;
      // if (guild) {
      // oldStickers = guild.stickers;
      // guild.update(packet.d);
      // stickers = guild.stickers;
      // }
      // this.emit('guildStickersUpdate', guild || { id: packet.guildId }, stickers, oldStickers);
      // break;
      // }

      case 'CHANNEL_PINS_UPDATE': {
        const packet = pkt.d as Camelize<DiscordChannelPinsUpdate>

        const channel = this.client.getChannel(packet.channelId)
        if (!channel) {
          this.emit('debug', `CHANNEL_PINS_UPDATE target channel ${packet.channelId} not found`)
          break
        }
        const oldTimestamp = channel.lastPinTimestamp
        channel.lastPinTimestamp = Date.parse(packet.lastPinTimestamp ?? '')

        this.emit('channelPinUpdate', channel, channel.lastPinTimestamp, oldTimestamp)
        break
      }
      case 'WEBHOOKS_UPDATE': {
        const packet = pkt.d as Camelize<DiscordWebhookUpdate>

        this.emit('webhooksUpdate', {
          channelID: packet.channelId,
          guildID: packet.guildId,
        })
        break
      }
      case 'THREAD_CREATE': {
        const packet = pkt.d as Camelize<DiscordChannel>

        const channel = Channel.from(packet.d, this.client) as ThreadChannel
        if (!channel.guild) {
          channel.guild = this.client.guilds.get(packet.guildId ?? '')!
          if (!channel.guild) {
            this.emit('debug', `Received THREAD_CREATE for channel in missing guild ${packet.guildId}`)
            break
          }
        }
        channel.guild.threads.add(channel, this.client)
        this.client.threadGuildMap[packet.id] = packet.guildId ?? ''

        this.emit('threadCreate', channel)
        break
      }
      case 'THREAD_UPDATE': {
        const packet = pkt.d as Camelize<DiscordChannel>

        const channel = this.client.getChannel(packet.id)
        if (!channel) {
          const thread = Channel.from(packet.d, this.client) as ThreadChannel
          this.emit('threadUpdate', this.client.guilds.get(packet.guildId ?? '')?.threads.add(thread, this.client), null)
          this.client.threadGuildMap[packet.id] = packet.guildId ?? ''
          break
        }
        if (!(channel instanceof ThreadChannel)) {
          this.emit('warn', `Unexpected THREAD_UPDATE for channel ${packet.id} with type ${channel.type}`)
          break
        }
        const oldChannel = {
          name: channel.name,
          rateLimitPerUser: channel.rateLimitPerUser,
          threadMetadata: channel.threadMetadata,
        }
        channel.update(packet.d)

        this.emit('threadUpdate', channel, oldChannel)
        break
      }
      case 'THREAD_DELETE': {
        const packet = pkt.d as Camelize<Pick<DiscordChannel, 'id' | 'guildId' | 'parent_id' | 'type'>>

        delete this.client.threadGuildMap[packet.id]
        const guild = this.client.guilds.get(packet.guildId ?? '')
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in THREAD_DELETE`)
          break
        }
        const channel = guild.threads.get(packet.id)
        guild.threads.delete(packet.id)
        if (!channel) {
          break
        }

        this.emit('threadDelete', channel)
        break
      }
      case 'THREAD_LIST_SYNC': {
        const packet = pkt.d as Camelize<DiscordThreadListSync>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in THREAD_LIST_SYNC`)
          break
        }
        const deletedThreads = (packet.channelIds ?? guild.threads.map((c) => c.id)) // REVIEW Is this a good name?
          .filter((c) => !packet.threads.some((t) => t.id === c))
          .map((id) => guild.threads.remove({ id }) ?? { id })
        const activeThreads = packet.threads.map((t) => guild.threads.update(t, this.client))
        const joinedThreadsMember = packet.members.map((m) => guild.threads.get(m.id)?.members.update(m, this.client))

        this.emit('threadListSync', guild, deletedThreads, activeThreads, joinedThreadsMember)
        break
      }
      // TODO: Add this when dd has the support for this event
      // case 'THREAD_MEMBER_UPDATE': {
      //     const channel = this.client.getChannel(packet.id);
      //     if (!channel) {
      //         this.emit('debug', `Missing channel ${packet.id} in THREAD_MEMBER_UPDATE`);
      //         break;
      //     }
      //     let oldMember = null;
      //     // Thanks Discord
      //     packet.threadId = packet.id;
      //     let member = channel.members.get((packet.id = packet.userId));
      //     if (member) {
      //         oldMember = {
      //             flags: member.flags,
      //         };
      //     }
      //     member = channel.members.update(packet.d, this.client);
      //     this.emit('threadMemberUpdate', channel, member, oldMember);
      //     break;
      // }
      case 'THREAD_MEMBERS_UPDATE': {
        const packet = pkt.d as Camelize<DiscordThreadMembersUpdate>

        const channel = this.client.getChannel(packet.id) as unknown as ThreadChannel
        if (!channel) {
          this.emit('debug', `Missing channel ${packet.id} in THREAD_MEMBERS_UPDATE`)
          break
        }
        channel.update(packet.d)
        let addedMembers
        let removedMembers
        if (packet.addedMembers) {
          addedMembers = packet.addedMembers.map((m) => {
            if (m.presence) {
              m.presence.id = m.presence.user.id
              this.client.users.update(m.presence.user, this.client)
            }

            m.threadId = m.id
            m.id = m.userId
            m.member.id = m.member.user.id
            const guild = this.client.guilds.get(packet.guildId)
            if (guild) {
              if (m.presence) {
                guild.members.update(m.presence, guild)
              }
              guild.members.update(m.member, guild)
            }
            return channel.members.update(m, this.client)
          })
        }
        if (packet.removedMemberIds) {
          removedMembers = packet.removedMemberIds.map((id) => channel.members.remove({ id }) ?? { id })
        }

        this.emit('threadMembersUpdate', channel, addedMembers ?? [], removedMembers ?? [])
        break
      }
      case 'STAGE_INSTANCE_CREATE': {
        const packet = pkt.d as Camelize<DiscordStageInstance>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('debug', `Missing guild ${packet.guildId} in STAGE_INSTANCE_CREATE`)
          break
        }

        this.emit('stageInstanceCreate', guild.stageInstances.add(new StageInstance(packet.d, this.client)))
        break
      }
      case 'STAGE_INSTANCE_UPDATE': {
        const packet = pkt.d as Camelize<DiscordStageInstance>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('stageInstanceUpdate', packet.d, null)
          break
        }
        const stageInstance = guild.stageInstances.get(packet.id)
        let oldStageInstance = null
        if (stageInstance) {
          oldStageInstance = {
            topic: stageInstance.topic,
          }
        }

        this.emit('stageInstanceUpdate', guild.stageInstances.update(new StageInstance(packet.d, this.client)), oldStageInstance)
        break
      }
      case 'STAGE_INSTANCE_DELETE': {
        const packet = pkt.d as Camelize<DiscordStageInstance>

        const guild = this.client.guilds.get(packet.guildId)
        if (!guild) {
          this.emit('stageInstanceDelete', new StageInstance(packet.d, this.client))
          break
        }

        this.emit('stageInstanceDelete', guild.stageInstances.remove(packet.d) ?? new StageInstance(packet.d, this.client))
        break
      }
      case 'GUILD_INTEGRATIONS_UPDATE': {
        // Ignore this
        break
      }
      case 'INTERACTION_CREATE': {
        const packet = pkt.d as Camelize<DiscordInteraction>

        this.emit('interactionCreate', Interaction.from(packet.d, this.client))
        break
      }
      default: {
        this.emit('unknown', pkt, this.id)
        break
      }
    } /* eslint-enable no-redeclare */
  }

  _onWSClose(event: { code: number; reason: string }) {
    let { code, reason } = event

    reason = reason.toString()
    this.emit(
      'debug',
      'WS disconnected: ' +
        JSON.stringify({
          code,
          reason,
          status: this.status,
        }),
    )
    let err: (Error & { code?: number }) | null = !code || code === 1000 ? null : new Error(code + ': ' + reason)
    let reconnect: 'auto' | boolean = 'auto'
    if (code) {
      this.emit('debug', `${code === 1000 ? 'Clean' : 'Unclean'} WS close: ${code}: ${reason}`, this.id)
      if (code === 4001) {
        err = new Error('Gateway received invalid OP code')
      } else if (code === 4002) {
        err = new Error('Gateway received invalid message')
      } else if (code === 4003) {
        err = new Error('Not authenticated')
        this.sessionID = null
      } else if (code === 4004) {
        err = new Error('Authentication failed')
        this.sessionID = null
        reconnect = false
        this.emit('error', new Error(`Invalid token: ${this.token}`))
      } else if (code === 4005) {
        err = new Error('Already authenticated')
      } else if (code === 4006 || code === 4009) {
        err = new Error('Invalid session')
        this.sessionID = null
      } else if (code === 4007) {
        err = new Error('Invalid sequence number: ' + this.seq)
        this.seq = 0
      } else if (code === 4008) {
        err = new Error('Gateway connection was ratelimited')
      } else if (code === 4010) {
        err = new Error('Invalid shard key')
        this.sessionID = null
        reconnect = false
      } else if (code === 4011) {
        err = new Error('Shard has too many guilds (>2500)')
        this.sessionID = null
        reconnect = false
      } else if (code === 4013) {
        err = new Error('Invalid intents specified')
        this.sessionID = null
        reconnect = false
      } else if (code === 4014) {
        err = new Error('Disallowed intents specified')
        this.sessionID = null
        reconnect = false
      } else if (code === 1006) {
        err = new Error('Connection reset by peer')
      } else if (code !== 1000 && reason) {
        err = new Error(code + ': ' + reason)
      }
      if (err) {
        err.code = code
      }
    } else {
      this.emit('debug', 'WS close: unknown code: ' + reason, this.id)
    }
    this.disconnect(
      {
        reconnect,
      },
      err ?? undefined,
    )
  }

  _onWSError(err: Error) {
    this.emit('error', err, this.id)
  }

  _onWSMessage(data) {
    try {
      if (data instanceof ArrayBuffer) {
        if (this.client.options.compress) {
          data = Buffer.from(data)
        }
      } else if (Array.isArray(data)) {
        // Fragmented messages
        data = Buffer.concat(data) // Copyfull concat is slow, but no alternative
      }
      if (this.client.options.compress) {
        if (data.length >= 4 && data.readUInt32BE(data.length - 4) === 0xffff) {
          return this.onPacket(JSON.parse(data.toString()))
        }
      } else {
        return this.onPacket(JSON.parse(data.toString()))
      }
    } catch (err) {
      this.emit('error', err, this.id)
    }
  }

  _onWSOpen() {
    this.status = 'handshaking'
    this.emit('connect', this.id)
    this.lastHeartbeatAck = true
  }

  toString() {
    return Base.prototype.toString.call(this)
  }

  toJSON(props: string[] = []) {
    return Base.prototype.toJSON.call(this, [
      'connecting',
      'ready',
      'discordServerTrace',
      'status',
      'lastHeartbeatReceived',
      'lastHeartbeatSent',
      'latency',
      'preReady',
      'getAllUsersCount',
      'getAllUsersQueue',
      'getAllUsersLength',
      'guildSyncQueue',
      'guildSyncQueueLength',
      'unsyncedGuilds',
      'lastHeartbeatAck',
      'seq',
      'sessionID',
      'reconnectInterval',
      'connectAttempts',
      ...props,
    ])
  }
}

export default Shard
