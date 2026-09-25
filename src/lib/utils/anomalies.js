// Anomaly checks for the Discord alerts (issue #269). Pure: data in, a verdict or a Discord
// payload out, so every threshold is unit-tested apart from the scheduler and the network.

export const SPIKE_LOOKBACK_DAYS = 28;
export const SPIKE_MIN_Z = 3;

const mean = values => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Was `targetDate` an unusually high revenue day? Compared with the SPIKE_LOOKBACK_DAYS days
 * before it (days with no row count as $0): a spike is at least SPIKE_MIN_Z standard
 * deviations above that mean. Measured on the live history: about 14 days a year.
 *
 * @param {{date: string, daily_revenue_usd: number}[]} rows  daily USD, any order
 * @returns {{usd, typicalUsd, z, multiple} | null}  null = not a spike (or not enough history)
 */
export function revenueSpike(rows, targetDate) {
  const byDate = new Map((rows ?? []).map(r => [String(r.date).slice(0, 10), Number(r.daily_revenue_usd) || 0]));
  if (!byDate.has(targetDate)) return null;
  const target = Date.parse(`${targetDate}T00:00:00Z`);
  const history = [];
  for (let i = 1; i <= SPIKE_LOOKBACK_DAYS; i++) {
    const day = new Date(target - i * 86_400_000).toISOString().slice(0, 10);
    history.push(byDate.get(day) ?? 0);
  }
  // Too little history (a fresh install) says nothing about what is unusual.
  if (history.filter(v => v > 0).length < SPIKE_LOOKBACK_DAYS / 2) return null;
  const m = mean(history);
  const sd = Math.sqrt(mean(history.map(v => (v - m) ** 2)));
  const usd = byDate.get(targetDate);
  if (!(sd > 0) || usd <= m) return null;
  const z = (usd - m) / sd;
  if (z < SPIKE_MIN_Z) return null;
  return { usd, typicalUsd: m, z: Math.round(z * 10) / 10, multiple: m > 0 ? Math.round((usd / m) * 10) / 10 : null };
}

/** The day's biggest payment, with who/how it was paid: 'Flux team', 'card' or 'FLUX'. */
export function largestPayment(transactions, { isTeam, isFiat }) {
  let best = null;
  for (const tx of transactions ?? []) {
    const usd = Number(tx.amount_usd) || 0;
    if (!best || usd > best.usd) best = { tx, usd };
  }
  if (!best) return null;
  const from = best.tx.from_address;
  return {
    appName: best.tx.app_name || 'unknown app',
    usd: best.usd,
    flux: Number(best.tx.amount) || 0,
    paidBy: isTeam(from) ? 'Flux team' : isFiat(from) ? 'card (fiat on-ramp)' : 'FLUX'
  };
}

/** Hours since the newest synced payment, or null with nothing synced. */
export function hoursSinceLastPayment(latestTimestampSec, nowMs) {
  const t = Number(latestTimestampSec);
  if (!(t > 0)) return null;
  return (nowMs - t * 1000) / 3_600_000;
}

const usd = v => '$' + Math.round(v).toLocaleString('en-US');
const ORANGE = 0xf97316;
const GREEN = 0x00ff41;

export function buildSpikePayload(date, spike, biggest) {
  const fields = [
    { name: 'Revenue', value: `${usd(spike.usd)} (a typical day is about ${usd(spike.typicalUsd)})`, inline: false }
  ];
  if (biggest) {
    fields.push({
      name: 'Biggest payment',
      value: `${biggest.appName}: ${usd(biggest.usd)}, paid by ${biggest.paidBy}`,
      inline: false
    });
  }
  return {
    embeds: [{
      title: `Unusual revenue day: ${date}`,
      description: `Revenue was ${spike.multiple ? `${spike.multiple}x` : 'well above'} the daily average of the previous ${SPIKE_LOOKBACK_DAYS} days.`,
      color: ORANGE,
      fields,
      footer: { text: 'Fluxtracker anomaly alert' }
    }]
  };
}

export function buildOutagePayload(hours, latestTimestampSec) {
  return {
    embeds: [{
      title: 'No new payments synced',
      description: `No payment has synced for ${Math.floor(hours)} hours (last one at ${new Date(latestTimestampSec * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC). ` +
        'In the last 12 months there was never a day without a payment, so this usually means the revenue sync has stopped.',
      color: ORANGE,
      footer: { text: 'Fluxtracker anomaly alert -- one message per outage' }
    }]
  };
}

export function buildRecoveryPayload(outageHours) {
  return {
    embeds: [{
      title: 'Payments syncing again',
      description: outageHours ? `New payments are arriving again after about ${Math.round(outageHours)} hours.` : 'New payments are arriving again.',
      color: GREEN,
      footer: { text: 'Fluxtracker anomaly alert' }
    }]
  };
}
