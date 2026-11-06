import type { MessageFormatFunc, PrettyOptions } from 'pino-pretty';
import { concatenateStrings } from '#utils/concateStrings';

type Colors = Parameters<MessageFormatFunc>[3]['colors'];

const HIDDEN_FIELDS = [
  'pid',
  'hostname',
  'service',
  'env',
  'requestId',
  'module',
  'type',
  'method',
  'path',
  'status',
  'durationMs',
  'contentLength',
  'ip',
  'userAgent',
  'errorCode',
  'slow',
  'aborted',
];

const CUSTOMIZE_COLOR = {
  trace: 'gray',
  debug: 'blue',
  info: 'green',
  warn: 'yellow',
  error: 'red',
  fatal: 'bgRed',
};

const getPaint = (statusCode: number, colors: Colors) => {
  if (statusCode >= 500) return colors.red;
  if (statusCode >= 400) return colors.yellow;
  if (statusCode >= 300) return colors.cyan;
  return colors.green;
};

const shortId = (id: unknown) => String(id).slice(0, 8);

// Log lines are untyped JSON (Record<string, unknown>), so every field is converted explicitly.
const messageFormat: MessageFormatFunc = (log, messageKey, levelLabel, { colors }) => {
  const id = log.requestId ? colors.gray(`[${shortId(log.requestId)}]`) : '';

  switch (log.type) {
    case 'http': {
      const status = Number(log.status);
      const paint = getPaint(status, colors);
      const timing = log.slow ? colors.yellow : colors.gray;
      return concatenateStrings(
        [
          id,
          colors.bold(String(log.method)),
          String(log.path),
          paint(status),
          timing(`${String(log.durationMs)}ms`),
          log.aborted ? colors.red('ABORTED') : '',
          typeof log.errorCode === 'string' ? colors.red(log.errorCode) : '',
        ],
        ' ',
      );
    }
    default: {
      const mod = typeof log.module === 'string' ? colors.magenta(`(${log.module})`) : '';
      return concatenateStrings([id, mod, String(log[messageKey])], ' ');
    }
  }
};

export const createPrettyStream = async ({
  destination = 1,
}: { destination?: PrettyOptions['destination'] } = {}) => {
  const { default: pretty } = await import('pino-pretty');

  return pretty({
    colorize: true,
    sync: true,
    destination,
    translateTime: 'HH:MM:ss.l',
    ignore: concatenateStrings(HIDDEN_FIELDS, ','),
    customColors: CUSTOMIZE_COLOR,
    messageFormat,
  });
};
