import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

// Every WCAG 2.0, 2.1 and 2.2 success criterion at level A and AA that axe can test.
const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

type Result = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

const describe = (violation: Result) =>
  [
    `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}`,
    ...violation.nodes.slice(0, 5).map((node) => `  ${node.target.join(' ')}: ${node.html}`),
  ].join('\n');

/**
 * Runs axe on the page as it is now, once every finite animation has finished, so a
 * drawer still sliding or a colour still fading is never judged half-way.
 * Returns one readable line block per violated rule; an empty list means no violation.
 */
export async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  return violations.map(describe);
}

/** The ids of the rules axe reports as violated. */
export async function violatedRules(page: Page): Promise<string[]> {
  return (await axeViolations(page)).map((line) => line.split(' ')[0]!);
}
