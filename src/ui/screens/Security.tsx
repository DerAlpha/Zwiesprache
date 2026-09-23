import { t } from '../../i18n/de';
import { Page } from '../components/Layout';
import { useController } from '../hooks';

export function Security() {
  const c = useController();
  return (
    <Page title={t.security.title} onBack={() => c.back()}>
      <div class="prose">
        {t.security.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
      </div>
    </Page>
  );
}
