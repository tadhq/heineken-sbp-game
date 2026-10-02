import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "generated/**", "node_modules/**", "next-env.d.ts", "public/sw.js"] },
];

export default config;
