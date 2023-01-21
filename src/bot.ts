// import { createRestManager } from '@discordeno/rest'
// import { createGatewayManager } from '@discordeno/gateway'
import { DISCORD_TOKEN } from './configs.js'
import { createRestManager } from './rest/manager.js'
import { createGatewayManager } from './gateway/manager.js'

export const Gamer = {
  // TODO: replace with logger
  logger: console,
  rest: createRestManager({
    token: DISCORD_TOKEN,
  }),
  gateway: createGatewayManager({
    token: DISCORD_TOKEN,
    events: {
      connected(shard) {
        console.log('[Gateway] Connected')
      },
      connecting(shard) {
        console.log('[Gateway] Connecting')
      },
      disconnected(shard) {
        console.log('[Gateway] Disconnected')
      },
      heartbeat(shard) {
        console.log('[Gateway] heartbeat')
      },
      heartbeatAck(shard) {
        console.log('[Gateway] Heartbeat ACK')
      },
      hello(shard) {
        console.log('[Gateway] Hello')
      },
      identified(shard) {
        console.log('[Gateway] identified')
      },
      identifying(shard) {
        console.log('[Gateway] identifying')
      },
      invalidSession(shard, resumable) {
        console.log('[Gateway] invalidSession')
      },
      message(shard, payload) {
        console.log('[Gateway] message', shard.id, payload)
      },
      requestedReconnect(shard) {
        console.log('[Gateway] requestedReconnect')
      },
      resumed(shard) {
        console.log('[Gateway] resumed')
      },
      resuming(shard) {
        console.log('[Gateway] resuming')
      },
    },
  }),
}
