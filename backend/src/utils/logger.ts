type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

interface LogData {
  [key: string]: unknown;
}

function log(severity: Severity, message: string, data?: LogData) {
  const entry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, data?: LogData) => log('DEBUG', msg, data),
  info: (msg: string, data?: LogData) => log('INFO', msg, data),
  warn: (msg: string, data?: LogData) => log('WARNING', msg, data),
  error: (msg: string, err?: Error, data?: LogData) =>
    log('ERROR', msg, {
      ...data,
      error: err ? { message: err.message, stack: err.stack } : undefined,
    }),
};
