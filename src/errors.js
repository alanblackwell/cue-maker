// Keeps the most recent errors and warnings so they can go in a bug report.
// Imported first by main.js so it also sees errors from module start-up.

const MAX_ENTRIES = 200;
const log = [];

function describe(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function note(level, ...args) {
  log.push({ at: new Date().toISOString(), level, message: args.map(describe).join(' ') });
  if (log.length > MAX_ENTRIES) log.shift();
}

for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    note(level, ...args);
    original(...args);
  };
}
window.addEventListener('error', e => note('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', e => note('error', 'Unhandled rejection:', e.reason));

export const getLog = () => log.slice();
