// ESLint v9 flat config.
// eslint-config-next 16 ships a native flat-config array — import it directly.

import next from "eslint-config-next/core-web-vitals";

const config = [
  ...next,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "var/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
