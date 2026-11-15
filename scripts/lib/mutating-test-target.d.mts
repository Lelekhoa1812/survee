export function isLocalTestTarget(base: string | URL): boolean;
export function assertSafeMutatingTestTarget(
  base: string | URL,
  purpose: string,
  env?: Record<string, string | undefined>,
): URL;
