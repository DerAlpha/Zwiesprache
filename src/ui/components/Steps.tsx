import { t } from '../../i18n/de';

/** Schrittanzeige des Verbindungsassistenten. `current` ist 0-basiert. */
export function Steps({ labels, current }: { labels: readonly string[]; current: number }) {
  return (
    <nav aria-label={t.steps.label}>
      <p class="visually-hidden">{t.steps.current(current + 1, labels.length)}</p>
      <ol class="steps">
        {labels.map((label, i) => (
          <li
            key={label}
            class={i < current ? 'step done' : i === current ? 'step current' : 'step'}
            aria-current={i === current ? 'step' : undefined}
          >
            <span class="step-dot" aria-hidden="true">
              {i < current ? '✓' : i + 1}
            </span>
            <span class="step-label">{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
