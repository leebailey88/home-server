export function parseWifiBitrateMbps(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/([\d.]+)\s*MBit\/s/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function counterDelta(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }

  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber)) return null;
  if (currentNumber < previousNumber) return null;
  return currentNumber - previousNumber;
}

export function evaluateWifiRecoveryEvidence(
  { networkStatus, rxBitrateMbps, rxDroppedDelta },
  { maxRxBitrateMbps = 12, minRxDroppedDelta = 5000 } = {},
) {
  const networkDegraded = networkStatus === 'warn' || networkStatus === 'fail';
  const lowRxBitrate =
    rxBitrateMbps !== null &&
    rxBitrateMbps !== undefined &&
    Number.isFinite(Number(rxBitrateMbps)) &&
    Number(rxBitrateMbps) <= maxRxBitrateMbps;
  const driverDrops =
    rxDroppedDelta !== null &&
    rxDroppedDelta !== undefined &&
    Number.isFinite(Number(rxDroppedDelta)) &&
    Number(rxDroppedDelta) >= minRxDroppedDelta;

  const reasons = [];
  if (lowRxBitrate) {
    reasons.push(`rx bitrate ${Number(rxBitrateMbps).toFixed(1)} MBit/s <= ${maxRxBitrateMbps}`);
  }
  if (driverDrops) {
    reasons.push(`rx_dropped delta ${Number(rxDroppedDelta)} >= ${minRxDroppedDelta}`);
  }

  return {
    eligible: networkDegraded && (lowRxBitrate || driverDrops),
    networkDegraded,
    lowRxBitrate,
    driverDrops,
    reasons,
  };
}

export function observationIsRecent(checkedAt, nowMs, maxGapSeconds) {
  if (!checkedAt) return false;
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return false;
  const ageMs = nowMs - checkedAtMs;
  return ageMs >= 0 && ageMs <= maxGapSeconds * 1000;
}

export function recoveryCooldownRemainingSeconds(lastRecoveryAt, nowMs, cooldownSeconds) {
  if (!lastRecoveryAt) return 0;
  const recoveredAtMs = Date.parse(lastRecoveryAt);
  if (!Number.isFinite(recoveredAtMs)) return 0;
  const remainingMs = recoveredAtMs + cooldownSeconds * 1000 - nowMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}
