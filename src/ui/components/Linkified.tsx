import { useMemo } from 'preact/hooks';
import { splitLinks } from '../linkify';

/** Text mit anklickbaren http(s)-Links. Alles wird als Text gerendert (Preact escaped automatisch). */
export function Linkified({ text }: { text: string }) {
  const segments = useMemo(() => splitLinks(text), [text]);
  return (
    <>
      {segments.map((s, i) =>
        s.type === 'text' ? (
          s.value
        ) : (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer">
            {s.value}
          </a>
        ),
      )}
    </>
  );
}
