/** @type {import("prettier").Config} */
const config = {
  plugins: ['prettier-plugin-astro'],
  // Match the quote style and line length this codebase already uses.
  singleQuote: true,
  printWidth: 100,
};

export default config;
