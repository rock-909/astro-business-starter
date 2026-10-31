import type { ContentPage } from '../../site';

const termsPage = {
  metadata: {
    title: 'Condiciones — pendientes de completar',
    description:
      'Texto provisional incompleto. El responsable debe sustituirlo antes del lanzamiento.',
    updatedAt: '2026-08-06',
    seo: {
      title: 'Condiciones — pendientes de completar',
      description:
        'Texto provisional incompleto. El responsable debe sustituirlo antes del lanzamiento.',
    },
  },
  content: String.raw`
Estas condiciones están incompletas. Antes del lanzamiento, el responsable debe indicar su identidad, el uso del sitio, la gestión de consultas, las condiciones aplicables y un medio de contacto operativo.

Sustituye este texto provisional por condiciones revisadas para la actividad real y la legislación aplicable.
`,
} satisfies ContentPage;

export default termsPage;
