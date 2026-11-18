const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
let threshold = LEVELS.info

export function setLevel(level) {
  threshold = LEVELS[level] ?? LEVELS.info
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function emit(level, args) {
  if (LEVELS[level] < threshold) return
  const line = `${ts()} ${level.toUpperCase().padEnd(5)}`
  if (level === 'error') console.error(line, ...args)
  else if (level === 'warn') console.warn(line, ...args)
  else console.log(line, ...args)
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
}
