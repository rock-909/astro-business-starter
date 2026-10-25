import type { ContentPage } from "../../site";

const contactPage = {
  metadata: {
    title: "Contacto",
    updatedAt: "2026-08-06",
    seo: {
      title: "Contacto — Sitio de referencia para consultas",
      description:
        "Página de contacto de referencia con la información mínima que debe sustituir una empresa real.",
    },
  },
  content: String.raw`
Utiliza el **[formulario de consulta](/contact#inquiry)**. Este sitio de referencia no está listo para recibir consultas comerciales hasta que su responsable configure el envío y los datos de contacto.
`,
} satisfies ContentPage;

export default contactPage;

