/**
 * ICS Calendar Import Service
 * Parses .ics files and extracts VEVENT entries into structured data.
 * Pure functions, no external dependencies.
 */

export interface CalendarEvent {
  title: string;
  description?: string;
  startDateTime: Date;
  endDateTime?: Date;
  location?: string;
  uid?: string;
}

/**
 * Parse ICS content string into calendar events.
 * Handles VEVENT blocks with SUMMARY, DTSTART, DTEND, DESCRIPTION, LOCATION, UID.
 * Supports both datetime (20260215T140000Z) and date-only (20260215) formats.
 */
export function parseICS(icsContent: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const lines = unfoldICS(icsContent);

  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === 'BEGIN:VEVENT') {
      const event = parseVEVENT(lines, i);
      if (event) events.push(event);
    }
    i++;
  }

  return events;
}

/**
 * ICS files can have long lines folded with a leading space/tab on continuation lines.
 * Unfold them first.
 */
function unfoldICS(content: string): string[] {
  const raw = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return raw
    .split('\n')
    .reduce((acc: string[], line) => {
      if ((line.startsWith(' ') || line.startsWith('\t')) && acc.length > 0) {
        acc[acc.length - 1] += line.slice(1);
      } else {
        acc.push(line);
      }
      return acc;
    }, []);
}

function parseVEVENT(lines: string[], startIndex: number): CalendarEvent | null {
  let title = '';
  let description: string | undefined;
  let startDateTime: Date | undefined;
  let endDateTime: Date | undefined;
  let location: string | undefined;
  let uid: string | undefined;

  let i = startIndex + 1;
  while (i < lines.length && lines[i].trim() !== 'END:VEVENT') {
    const line = lines[i].trim();
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const property = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);

    const propBase = property.split(';')[0];

    switch (propBase) {
      case 'SUMMARY':
        title = unescapeICS(value);
        break;
      case 'DESCRIPTION':
        description = unescapeICS(value);
        break;
      case 'DTSTART':
        startDateTime = parseICSDate(value);
        break;
      case 'DTEND':
        endDateTime = parseICSDate(value);
        break;
      case 'LOCATION':
        location = unescapeICS(value);
        break;
      case 'UID':
        uid = value;
        break;
    }
    i++;
  }

  if (!title || !startDateTime) return null;

  return {
    title,
    description: description || undefined,
    startDateTime,
    endDateTime: endDateTime || undefined,
    location: location || undefined,
    uid: uid || undefined,
  };
}

/**
 * Parse ICS date/datetime formats:
 * - 20260215T140000Z (UTC datetime)
 * - 20260215T140000  (local datetime)
 * - 20260215         (all-day date, treated as midnight UTC)
 */
function parseICSDate(value: string): Date | undefined {
  const clean = value.trim();
  const utcMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utcMatch) {
    const [, y, mo, d, h, mi, s] = utcMatch.map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  }

  const localMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (localMatch) {
    const [, y, mo, d, h, mi, s] = localMatch.map(Number);
    return new Date(y, mo - 1, d, h, mi, s);
  }

  const dateMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    const [, y, mo, d] = dateMatch.map(Number);
    return new Date(y, mo - 1, d, 0, 0, 0);
  }

  return undefined;
}

/**
 * Unescape ICS text escapes: \n, \\, \;, \,
 */
function unescapeICS(text: string): string {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\;/g, ';')
    .replace(/\\,/g, ',')
    .replace(/\\\\/g, '\\');
}
