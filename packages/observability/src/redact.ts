/**
 * Redaction runs on every log line and on every artifact preview. It is intentionally
 * conservative: it removes credential shapes and long opaque blobs rather than deciding per
 * call site, because a missed call site is the failure mode that leaks a token.
 */
const CREDENTIAL_PATTERNS: readonly [RegExp, string][] = [
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g, '[redacted-github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted-github-token]'],
  [/\bglpat-[A-Za-z0-9_-]{16,}\b/g, '[redacted-gitlab-token]'],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, '[redacted-api-key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted-slack-token]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-jwt]'],
  [/(Authorization:\s*)(\S+)/gi, '$1[redacted]'],
  [/(Bearer\s+)([A-Za-z0-9._~+/-]{8,}=*)/gi, '$1[redacted]'],
  [/(password["'\s:=]+)([^\s"',}]{4,})/gi, '$1[redacted]'],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[redacted-private-key]',
  ],
];

const EMAIL_PATTERN = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export const redactSecrets = (input: string): string =>
  CREDENTIAL_PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    input,
  );

/** Emails stay readable in domain at most; the local part is collapsed. */
export const redactEmails = (input: string): string =>
  input.replace(EMAIL_PATTERN, (_match, first: string, domain: string) => `${first}***@${domain}`);

/** Truncates agent output for storage and display so a runaway log cannot fill a database. */
export const clipOutput = (input: string, limit = 4000): string => {
  const redacted = redactSecrets(input);
  if (redacted.length <= limit) {
    return redacted;
  }
  return `${redacted.slice(0, limit)}... [truncated ${redacted.length - limit} characters]`;
};

/** Recursively redacts credential-shaped strings inside a JSON-safe value. */
export const redactValue = (value: unknown, depth = 0): unknown => {
  if (depth > 6) {
    return '[max-depth]';
  }
  if (typeof value === 'string') {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      if (
        ['password', 'token', 'secret', 'authorization', 'cookie', 'private_key'].some((needle) =>
          lowered.includes(needle),
        )
      ) {
        result[key] = '[redacted]';
        continue;
      }
      result[key] = redactValue(entry, depth + 1);
    }
    return result;
  }
  return value;
};
