/**
 * Resolves `@/` imports for `node --test` (Next's path alias is not visible to Node).
 * Registered from the npm test script.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let relative = specifier.slice(2);
    if (!pathHasExtension(relative)) {
      relative += ".ts";
    }
    return nextResolve(new URL(`../${relative}`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}

function pathHasExtension(value) {
  return /\.[cm]?[jt]sx?$/.test(value);
}
