// Seasonal sky furniture for the header art (issue #287).
//
// Most intros carry "sky furniture" -- gulls, wisps, a sun -- whose job is to keep rows
// non-empty. On a few dates those glyphs swap: bats and a moon for Halloween week, snow in
// December, and on New Year's Day a fireworks slot joins the rotation. Pure: the sky is a
// function of the UTC date alone, formatters receive it through ctx.sky, and with no season
// every frame is exactly what it was before.

/** The default sky -- what every frame used before seasons existed. */
export const PLAIN_SKY = Object.freeze({
  season: null,
  bird: 'v',         // Valheim's gulls
  sun: '(*)',        // Dragonwilds' and Minecraft's sun
  wisp: '~~',        // drifting cloud wisps
  cloud: '~~~~~~',   // Minecraft's clouds
  dayLabel: 'DAY 1', // Project Zomboid's sky
  newYear: false
});

const HALLOWEEN = Object.freeze({
  ...PLAIN_SKY,
  season: 'halloween',
  bird: '^v^',
  sun: ' ( ',
  dayLabel: 'NIGHT 1'
});

const DECEMBER = Object.freeze({
  ...PLAIN_SKY,
  season: 'december',
  wisp: '* ',
  cloud: '* . * ',
});

const NEW_YEAR = Object.freeze({ ...DECEMBER, season: 'new-year', newYear: true });

/**
 * The sky for a date, judged in UTC like every other date on the dashboard.
 * @param {Date|number} date
 */
export function skyFor(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return PLAIN_SKY;
  const month = d.getUTCMonth(); // 0-based
  const day = d.getUTCDate();
  if (month === 0 && day === 1) return NEW_YEAR;
  if (month === 9 && day >= 24) return HALLOWEEN;
  if (month === 11) return DECEMBER;
  return PLAIN_SKY;
}
