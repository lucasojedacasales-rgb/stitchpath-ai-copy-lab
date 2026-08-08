const COMMAND_ID_PADDING = 8;

export function canonicalCommandId(commandIndex, type) {
  if (!Number.isInteger(commandIndex) || commandIndex < 0) throw new Error('commandIndex must be a non-negative integer.');
  if (typeof type !== 'string' || !type) throw new Error('type must be a non-empty string.');
  return `canonical-command:${String(commandIndex).padStart(COMMAND_ID_PADDING, '0')}:${type}`;
}
