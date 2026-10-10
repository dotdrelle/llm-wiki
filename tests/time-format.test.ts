import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIME_FORMAT_SCRIPT } from '../src/chat/runtime/timeFormatScript.ts';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';

type Formatters = {
  formatLocalTime: (value: unknown, options?: { seconds?: boolean }) => string;
  formatLocalDateTime: (value: unknown, options?: { seconds?: boolean }) => string;
  localClockFromUtc: (clock: string, now?: Date) => string;
};

const load = (): Formatters => new Function(`${TIME_FORMAT_SCRIPT}\nreturn { formatLocalTime, formatLocalDateTime, localClockFromUtc };`)() as Formatters;

describe('chat time formatting (browser time zone)', () => {
  const previous = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'Europe/Paris'; });
  afterEach(() => { process.env.TZ = previous; });

  it('shows one event the same way everywhere, in local time', () => {
    const { formatLocalTime, formatLocalDateTime } = load();
    const at = '2026-10-10T08:31:10.840Z';
    expect(formatLocalTime(at)).toBe('10:31:10');
    expect(formatLocalTime(at, { seconds: false })).toBe('10:31');
    expect(formatLocalDateTime(at)).toBe('2026-10-10 10:31');
    expect(formatLocalDateTime(at, { seconds: true })).toBe('2026-10-10 10:31:10');
    // Epoch milliseconds, as a number or a string, are the same instant.
    expect(formatLocalTime(Date.parse(at))).toBe('10:31:10');
    expect(formatLocalTime(String(Date.parse(at)))).toBe('10:31:10');
    expect(formatLocalTime('not a date')).toBe('');
  });

  it('re-expresses the manager\'s UTC log clock in local time', () => {
    const { localClockFromUtc } = load();
    // The run journal showed 08:57:07 for an event at 10:57:07 in Paris.
    expect(localClockFromUtc('08:57:07', new Date('2026-10-10T09:00:00Z'))).toBe('10:57:07');
    // Just after midnight UTC, a clock of 23:59 is yesterday's, not tomorrow's.
    expect(localClockFromUtc('23:59:00', new Date('2026-10-11T00:05:00Z'))).toBe('01:59:00');
    expect(localClockFromUtc('')).toBe('');
  });

  it('is part of the chat script and the panels no longer format on their own', () => {
    expect(CHAT_HTML).toContain('function localClockFromUtc(');
    expect(CHAT_HTML).not.toMatch(/toLocale(Time|Date)?String\(/);
  });
});
