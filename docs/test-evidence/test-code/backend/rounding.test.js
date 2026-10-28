import { roundUp } from '../utils/rounding.js';

const MIN = 60;

describe('roundUp(seconds, minutes)', () => {
  it('rounds up to the next block of 15 minutes', () => {
    expect(roundUp(1, 15)).toBe(15 * MIN); // 1 s -> 15 min
    expect(roundUp(7 * MIN, 15)).toBe(15 * MIN);
    expect(roundUp(14 * MIN + 59, 15)).toBe(15 * MIN);
    expect(roundUp(22 * MIN, 15)).toBe(30 * MIN);
    expect(roundUp(61 * MIN, 15)).toBe(75 * MIN);
  });

  it('keeps an exact multiple as it is, and goes up a whole block one second after it', () => {
    expect(roundUp(15 * MIN, 15)).toBe(15 * MIN); // 15 min -> 15 min
    expect(roundUp(15 * MIN + 1, 15)).toBe(30 * MIN); // 15 min 1 s -> 30 min
    expect(roundUp(3600, 15)).toBe(3600);
    expect(roundUp(3601, 15)).toBe(75 * MIN);
  });

  it('keeps an empty entry at 0', () => {
    expect(roundUp(0, 15)).toBe(0);
    expect(roundUp(0, 0)).toBe(0);
  });

  it('does nothing when rounding is off (0 minutes or no value)', () => {
    expect(roundUp(7 * MIN, 0)).toBe(7 * MIN);
    expect(roundUp(1234, 0)).toBe(1234);
    expect(roundUp(1234, undefined)).toBe(1234);
    expect(roundUp(1234, null)).toBe(1234);
  });

  it('never goes below 0 and never rounds down', () => {
    expect(roundUp(-5, 15)).toBe(0);
    for (let seconds = 1; seconds <= 3 * 3600; seconds += 37) {
      const rounded = roundUp(seconds, 15);
      expect(rounded).toBeGreaterThanOrEqual(seconds);
      expect(rounded - seconds).toBeLessThan(15 * MIN);
      expect(rounded % (15 * MIN)).toBe(0);
    }
  });

  it('works for other block sizes too', () => {
    expect(roundUp(1, 30)).toBe(30 * MIN);
    expect(roundUp(31 * MIN, 30)).toBe(60 * MIN);
    expect(roundUp(1, 1)).toBe(MIN);
  });
});
