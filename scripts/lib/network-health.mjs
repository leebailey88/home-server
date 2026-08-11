export function parsePingOutput(output) {
  const packetMatch = output.match(
    /(\d+) packets transmitted,\s+(\d+) received,[^\n]*?([\d.]+)% packet loss/,
  );
  const rttMatch = output.match(
    /(?:rtt|round-trip) min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/,
  );
  const samplesMs = [...output.matchAll(/time[=<]([\d.]+)\s*ms/g)].map((match) =>
    Number(match[1]),
  );

  if (!packetMatch) {
    return null;
  }

  return {
    transmitted: Number(packetMatch[1]),
    received: Number(packetMatch[2]),
    lossPercent: Number(packetMatch[3]),
    minMs: rttMatch ? Number(rttMatch[1]) : null,
    avgMs: rttMatch ? Number(rttMatch[2]) : null,
    maxMs: rttMatch ? Number(rttMatch[3]) : null,
    samplesMs,
  };
}

export function evaluateNetworkHealth(
  metrics,
  {
    warnAvgMs = 25,
    failAvgMs = 100,
    warnHighLatencyMs = 100,
    warnHighLatencySamples = 3,
    failHighLatencyMs = 250,
    failHighLatencySamples = 3,
    failLossPercent = 25,
  } = {},
) {
  if (!metrics || metrics.transmitted <= 0) {
    return {
      status: 'fail',
      reasons: ['gateway ping did not produce a usable packet summary'],
      warnSampleCount: 0,
      failSampleCount: 0,
    };
  }

  const reasons = [];
  const warnings = [];
  const warnSampleCount = metrics.samplesMs.filter((value) => value >= warnHighLatencyMs).length;
  const failSampleCount = metrics.samplesMs.filter((value) => value >= failHighLatencyMs).length;

  if (metrics.lossPercent >= failLossPercent) {
    reasons.push(`packet loss ${metrics.lossPercent}% >= ${failLossPercent}%`);
  } else if (metrics.lossPercent > 0) {
    warnings.push(`packet loss ${metrics.lossPercent}%`);
  }

  if (metrics.avgMs !== null && metrics.avgMs >= failAvgMs) {
    reasons.push(`average latency ${metrics.avgMs.toFixed(1)}ms >= ${failAvgMs}ms`);
  } else if (metrics.avgMs !== null && metrics.avgMs >= warnAvgMs) {
    warnings.push(`average latency ${metrics.avgMs.toFixed(1)}ms >= ${warnAvgMs}ms`);
  }

  if (failSampleCount >= failHighLatencySamples) {
    reasons.push(
      `${failSampleCount} samples >= ${failHighLatencyMs}ms (limit ${failHighLatencySamples})`,
    );
  } else if (warnSampleCount >= warnHighLatencySamples) {
    warnings.push(
      `${warnSampleCount} samples >= ${warnHighLatencyMs}ms (warning ${warnHighLatencySamples})`,
    );
  }

  if (reasons.length > 0) {
    return { status: 'fail', reasons, warnSampleCount, failSampleCount };
  }

  if (warnings.length > 0) {
    return {
      status: 'warn',
      reasons: warnings,
      warnSampleCount,
      failSampleCount,
    };
  }

  return {
    status: 'ok',
    reasons: [],
    warnSampleCount,
    failSampleCount,
  };
}
