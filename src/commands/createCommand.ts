import type { ArgumentDefinition, Command } from "../types/commands";

export function createCommand<T extends readonly ArgumentDefinition[]>(command: Command<T>) {
  return command
}
