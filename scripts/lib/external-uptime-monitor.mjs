const diagnosticHeaders = ['server', 'cf-ray', 'cf-error-type', 'cf-error-origin'];

function cleanHeaderValue(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function formatResponseDiagnostics(headers) {
  const diagnostics = diagnosticHeaders.flatMap((name) => {
    const value = headers?.get?.(name);
    const cleaned = value ? cleanHeaderValue(value) : '';
    return cleaned ? [`${name}=${cleaned}`] : [];
  });

  return diagnostics.length > 0 ? `; ${diagnostics.join(' ')}` : '';
}

export function correlateRetryResults(initialFailures, retryResults) {
  const retryByKey = new Map(retryResults.map((result) => [result.key, result]));
  const persistent = [];
  const transient = [];

  for (const initial of initialFailures) {
    const retry = retryByKey.get(initial.key);
    if (retry?.ok) {
      transient.push({ initial, retry });
      continue;
    }

    persistent.push(retry || initial);
  }

  return { persistent, transient };
}
