import { t } from '../i18n/de';

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes: number): string {
  const [b, ...units] = t.files.units;
  if (bytes < 1024) return `${bytes} ${b}`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}
