import type { Command } from '../types/commands'
import ping from './general/ping.js'

export const commands: Record<string, Command<any>> = {
    ping,
}
