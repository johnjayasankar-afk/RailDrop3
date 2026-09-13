/**
 * `server-only` throws outside a React Server Component bundle, which would make
 * every CLI script that touches a server module crash on import.
 *
 * Scripts run under tsconfig.scripts.json, which maps the package to this
 * no-op. The real guard is untouched for the Next.js build — that is where it
 * matters, because that is where a client bundle could leak a secret.
 */
export {};
