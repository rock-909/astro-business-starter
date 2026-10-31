import type { ContentPage } from '../../site';

const privacyPage = {
  metadata: {
    title: 'Privacy policy — to be completed',
    description: 'Incomplete placeholder. The site operator must replace this before launch.',
    updatedAt: '2026-08-06',
    seo: {
      title: 'Privacy policy — to be completed',
      description: 'Incomplete placeholder. The site operator must replace this before launch.',
    },
  },
  content: String.raw`
This privacy policy is incomplete. Before launch, the site operator must document who controls the data, what is collected, its purpose, service providers, retention, cookies (including optional analytics and advertising cookies, which are only used with the visitor’s consent) and how people can exercise their rights.

The inquiry form works without optional analytics or advertising consent. Analytics consent permits UTM source details, the landing page and capture time; advertising consent permits advertising click identifiers. Rejecting or withdrawing a category stops its browser collection and removes its stored attribution from later inquiries. Withdrawing consent in the browser does not delete records already submitted to email or CRM; the final policy must explain retention and deletion requests.

Replace this placeholder with a policy reviewed for the actual business and applicable law.
`,
} satisfies ContentPage;

export default privacyPage;
