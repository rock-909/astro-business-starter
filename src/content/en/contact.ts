import type { ContentPage } from '../../site';

const contactPage = {
  metadata: {
    title: 'Contact',
    updatedAt: '2026-08-06',
    seo: {
      title: 'Contact — Inquiry Site Reference',
      description:
        'Reference contact page showing the minimum information a future business should replace.',
    },
  },
  content: String.raw`
Use the **[inquiry form](/contact#inquiry)** below. This reference site is not ready to receive business inquiries until its owner configures delivery and contact details.
`,
} satisfies ContentPage;

export default contactPage;
