import { describe, it, expect } from 'vitest';
import { medianDaysLeft } from './appTimeLeft.js';

const H = 3_000_000;
const DAY = 2880;
const app = (daysLeft, extra = {}) => ({ height: H - 100, expire: 100 + daysLeft * DAY, ...extra });

describe('medianDaysLeft', () => {
  it('takes the middle app, so a few 1-year apps do not drag it up', () => {
    const specs = [app(3), app(7), app(10), app(365), app(365)];
    expect(medianDaysLeft(specs, H)).toEqual({ medianDays: 10, apps: 5 });
  });

  it('averages the two middle apps when the count is even', () => {
    expect(medianDaysLeft([app(7), app(14), app(30), app(60)], H).medianDays).toBe(22);
  });

  it('leaves out expired specs and specs with no known term', () => {
    const specs = [app(7), app(9), { height: H - 5000, expire: 5000 }, { height: H - 10 }, { expire: 5000 }, null];
    expect(medianDaysLeft(specs, H)).toEqual({ medianDays: 8, apps: 2 });
  });

  it('rounds to one decimal', () => {
    expect(medianDaysLeft([{ height: H, expire: 1000 }], H).medianDays).toBe(0.3);
  });

  it('is null with no running app or no block height -- never 0', () => {
    expect(medianDaysLeft([], H)).toBeNull();
    expect(medianDaysLeft([{ height: H - 9000, expire: 5000 }], H)).toBeNull();
    expect(medianDaysLeft([app(7)], 0)).toBeNull();
    expect(medianDaysLeft(null, H)).toBeNull();
  });
});
