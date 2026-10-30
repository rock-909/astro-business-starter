import type { ContentPage } from '../../site';

const privacyPage = {
  metadata: {
    title: 'Privacidad — pendiente de completar',
    updatedAt: '2026-08-06',
    seo: {
      title: 'Privacidad — pendiente de completar',
      description:
        'Texto provisional incompleto. El responsable debe sustituirlo antes del lanzamiento.',
    },
  },
  content: String.raw`
Esta política de privacidad está incompleta. Antes del lanzamiento, el responsable debe indicar quién controla los datos, qué se recoge, con qué fin, los proveedores, la conservación, las cookies (incluidas las cookies opcionales de análisis y publicidad, que solo se usan con el consentimiento del visitante) y cómo ejercer los derechos.

El formulario de consulta funciona sin consentimiento opcional de análisis o publicidad. El consentimiento de análisis permite los datos UTM de origen, la página de entrada y la hora de captura; el de publicidad permite los identificadores de clic publicitario. Rechazar o retirar una categoría detiene su recogida en el navegador y elimina su atribución guardada de las consultas posteriores. Retirar el consentimiento en el navegador no elimina los registros ya enviados por correo o al CRM; la política final debe explicar la conservación y las solicitudes de eliminación.

Sustituye este texto provisional por una política revisada para la actividad real y la legislación aplicable.
`,
} satisfies ContentPage;

export default privacyPage;
