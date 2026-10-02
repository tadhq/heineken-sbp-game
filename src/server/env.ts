import "server-only";

/**
 * Required server env. No fallbacks: a missing secret must fail loudly, never silently
 * become a guessable default. Read lazily so `next build` can run without DB credentials.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get SESSION_SECRET() {
    const v = required("SESSION_SECRET");
    if (v.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return v;
  },
};
