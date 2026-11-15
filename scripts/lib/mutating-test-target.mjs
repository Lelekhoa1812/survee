const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PRIMARY_PRODUCTION_HOST = "kqa-bay.vercel.app";

export function isLocalTestTarget(base) {
  const url = base instanceof URL ? base : new URL(base);
  return LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

/** Refuse to run data-changing browser checks against a remote app by accident. */
export function assertSafeMutatingTestTarget(base, purpose, env = process.env) {
  let url;
  try {
    url = base instanceof URL ? base : new URL(base);
  } catch {
    throw new Error(`${purpose}: baseUrl must be a valid HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${purpose}: baseUrl must use HTTP(S) and must not contain credentials.`);
  }
  if (isLocalTestTarget(url)) return url;
  if (url.protocol !== "https:") {
    throw new Error(`${purpose}: remote test targets must use HTTPS.`);
  }
  if (env.KQA_E2E_ALLOW_REMOTE_MUTATIONS !== "1" || env.KQA_E2E_CONFIRM_ORIGIN !== url.origin) {
    throw new Error(
      `${purpose}: refusing remote target ${url.origin}. Use a disposable test deployment, then set KQA_E2E_ALLOW_REMOTE_MUTATIONS=1 and KQA_E2E_CONFIRM_ORIGIN to this exact origin.`,
    );
  }
  if (url.hostname.toLowerCase().replace(/\.$/, "") === PRIMARY_PRODUCTION_HOST && env.KQA_E2E_ALLOW_PRODUCTION_MUTATIONS !== "1") {
    throw new Error(
      `${purpose}: refusing the primary production host. Set KQA_E2E_ALLOW_PRODUCTION_MUTATIONS=1 only when the supplied respondent/interview is explicitly disposable.`,
    );
  }
  return url;
}
