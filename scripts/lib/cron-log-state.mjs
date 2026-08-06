function lastMatch(lines, patterns) {
  let match = null;

  lines.forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) {
      match = { index, line };
    }
  });

  return match;
}

export function evaluateCronLogState({ lines, errorPatterns, successPatterns }) {
  const lastError = lastMatch(lines, errorPatterns);
  const lastSuccess = lastMatch(lines, successPatterns);

  if (successPatterns.length > 0) {
    if (!lastSuccess) {
      return {
        ok: false,
        reason: lastError ? 'error' : 'missing-success',
        lastError,
        lastSuccess: null,
      };
    }

    if (lastError && lastError.index > lastSuccess.index) {
      return {
        ok: false,
        reason: 'error-after-success',
        lastError,
        lastSuccess,
      };
    }

    return {
      ok: true,
      reason: lastError ? 'success-after-error' : 'success',
      lastError,
      lastSuccess,
    };
  }

  if (lastError) {
    return {
      ok: false,
      reason: 'error',
      lastError,
      lastSuccess: null,
    };
  }

  return {
    ok: true,
    reason: 'no-error',
    lastError: null,
    lastSuccess: null,
  };
}
