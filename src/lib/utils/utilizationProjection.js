// Utilization Projection (issue #347): what the network would still be running on each of
// the coming days if NO app renewed. Every app spec carries the block it was registered at
// and how many blocks it was paid for, so its expiry block is known; this walks the calendar
// forward and counts what is still unexpired.
//
// Two measures, by the owner's decision:
//   - instances: exact for every app -- the instance count is readable even on encrypted
//     (enterprise) specs.
//   - CPU cores: only for specs whose resources are readable. Encrypted specs -- mostly the
//     dedicated game sites -- report 0 CPU, so this line covers part of the CPU in use and
//     the card has to say how much, never pass it off as the whole network.
//
// Pure: specs and the current block height in, a projection out.

export const BLOCKS_PER_DAY = 2880; // 30s blocks
const MS_PER_DAY = 86_400_000;

/** Ordered CPU cores for a spec: summed over compose components, times its instances. */
function orderedCpu(spec) {
  const perInstance = Array.isArray(spec.compose) && spec.compose.length > 0
    ? spec.compose.reduce((sum, c) => sum + (Number(c?.cpu) || 0), 0)
    : Number(spec.cpu) || 0;
  return perInstance * (Number(spec.instances) || 1);
}

/**
 * @param {object[]} specs  globalappsspecifications entries
 * @param {number} currentHeight  the chain's current block height
 * @param {{horizonDays?: number, nowMs?: number}} [options]
 */
export function computeUtilizationProjection(specs, currentHeight, { horizonDays = 180, nowMs = Date.now() } = {}) {
  if (!Array.isArray(specs) || !Number.isFinite(currentHeight) || currentHeight <= 0) return null;

  const apps = [];
  let unknownExpiry = 0;
  let cpuReadableApps = 0;
  let cpuUnreadableApps = 0;

  for (const spec of specs) {
    const height = Number(spec?.height);
    const expire = Number(spec?.expire);
    if (!Number.isFinite(height) || !Number.isFinite(expire) || expire <= 0) {
      unknownExpiry += 1;
      continue;
    }
    const expiryBlock = height + expire;
    // Past its expiry but still listed: the registry lags pruning. It is not running.
    if (expiryBlock <= currentHeight) continue;
    const cpu = spec.enterprise ? 0 : orderedCpu(spec);
    if (cpu > 0) cpuReadableApps += 1;
    else cpuUnreadableApps += 1;
    apps.push({ expiryBlock, instances: Number(spec.instances) || 1, cpu });
  }

  const points = [];
  for (let day = 0; day <= horizonDays; day++) {
    const atBlock = currentHeight + day * BLOCKS_PER_DAY;
    let instances = 0;
    let cpu = 0;
    for (const app of apps) {
      if (app.expiryBlock > atBlock) {
        instances += app.instances;
        cpu += app.cpu;
      }
    }
    points.push({ day, date: new Date(nowMs + day * MS_PER_DAY).toISOString().slice(0, 10), instances, cpu });
  }

  const today = points[0];
  const dropBy = day => {
    const point = points[Math.min(day, horizonDays)];
    return { instances: today.instances - point.instances, cpu: today.cpu - point.cpu };
  };

  // The week that loses the most instances: where renewals matter most.
  let biggestDrop = null;
  for (let start = 0; start + 7 <= horizonDays; start += 7) {
    const instances = points[start].instances - points[start + 7].instances;
    if (!biggestDrop || instances > biggestDrop.instances) {
      biggestDrop = {
        from: points[start].date,
        to: points[start + 7].date,
        instances,
        cpu: points[start].cpu - points[start + 7].cpu
      };
    }
  }

  return {
    blockHeight: currentHeight,
    horizonDays,
    points,
    today: { apps: apps.length, instances: today.instances, cpu: today.cpu },
    drops: { d7: dropBy(7), d30: dropBy(30), d90: dropBy(90) },
    biggestDrop,
    coverage: { cpuReadableApps, cpuUnreadableApps, unknownExpiry }
  };
}
