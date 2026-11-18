// cbBTC washout-reversal bot for the make.fun 24h BTC bot race
// (agent-fun/bars-replay/v1, one-minute bars, long only, paper money).
//
// Strategy, in one paragraph: this market (a thin on-chain cbBTC/USDC pool,
// one-minute bars) mean-reverts hard after washouts but grinds lower in
// between, and every round trip pays fees, slippage and constant-product
// price impact, so the bot trades rarely and only on one high-quality
// setup. After the price has fallen at least DRAWDOWN_BPS from its high of
// the last DRAWDOWN_LOOKBACK bars (a washout), the first close that breaks
// above the highest close of the last BREAKOUT_BARS bars (the first sign of
// strength after the fall) buys with all the cash the weight cap allows.
// The position then rides under a trailing stop: when a close falls
// TRAIL_BPS below the highest close since the entry decision, the bot
// sells everything, and keeps sending that sell on every later batch until
// the position is gone (a refused sell must not strand the position).
//
// Two guards keep a hostile window from bleeding the account:
//   - After an exit, a new entry first needs a close below the lowest
//     close of the episode that just ended. A grinding decline is full of
//     small bounces off the same level; without the guard each one would
//     re-trigger the setup and pay the trailing stop again.
//   - If equity ever falls to KILL_SWITCH_BPS of the starting capital, the
//     bot stops entering for the rest of the window and just manages its
//     exit: the race's guardrail disqualifies a drawdown over 25%, and
//     cash cannot breach it.
// In a window with no washout the bot simply holds cash and cannot bleed
// fees.
//
// Everything is decided from the bars in each batch and the account the
// hello/batch messages carry: no clock, no environment, no randomness, so
// the two graded executions produce byte-identical action logs.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

/** Bars of history behind the high a washout is measured from (4 hours). */
const DRAWDOWN_LOOKBACK = 240;
/** Fall from that high, in bps, that counts as a washout (1.5%). */
const DRAWDOWN_BPS = 150;
/** A close above the highest close of this many previous bars is the entry trigger. */
const BREAKOUT_BARS = 15;
/** Trailing stop under the peak close since entry, in bps (0.8%). */
const TRAIL_BPS = 80;
/** Equity, in bps of the starting capital, under which entries stop (92%). */
const KILL_SWITCH_BPS = 9200;
/** Slippage cap sent with every order: far above the modelled slippage plus a
 * full-size order's price impact, so a fill is not refused for the cap. */
const MAX_SLIPPAGE_BPS = 400;

/** Every close seen so far, oldest first (raw price units, as numbers). */
const closes: number[] = [];
/** Highest close since the current entry was decided; null while flat. */
let peak: number | null = null;
/** Lowest close since the current entry was decided; null while flat. */
let episodeLow: number | null = null;
/** The trailing stop has fired: keep selling until the position is gone. */
let stopFired = false;
/** A buy was sent on the previous batch and its fill is not yet visible. */
let awaitingFill = false;
/** Whether the previous batch still held the position (to spot the exit). */
let wasHeld = false;
/** Lowest close of the last finished episode; a new entry needs a close under it. */
let lastEpisodeLow: number | null = null;
/** A close under lastEpisodeLow has been seen since that episode ended. */
let sawFreshLow = false;

function highest(values: number[], from: number, to: number): number {
  let m = -Infinity;
  for (let i = from; i < to; i++) if (values[i]! > m) m = values[i]!;
  return m;
}

await runBars({
  onBatch(state: BarsState, _batch) {
    const symbol = state.hello.symbols[0]!.symbol;
    const bar = state.latest.get(symbol);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    closes.push(close);

    const held = state.positions.get(symbol);
    if (state.warmingUp) return [];

    if (held !== undefined) {
      // Riding a position: track the peak and the episode's low, and sell
      // all once a close falls TRAIL_BPS under the peak.
      wasHeld = true;
      awaitingFill = false;
      if (peak === null || close > peak) peak = close;
      if (episodeLow === null || close < episodeLow) episodeLow = close;
      if (close * 10000 <= peak * (10000 - TRAIL_BPS)) stopFired = true;
      if (stopFired) {
        const sell: OrderInput = { side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    if (wasHeld) {
      // The position is gone (the stop sell filled, or the window's own
      // close took it): remember the episode's low for the re-entry guard.
      wasHeld = false;
      lastEpisodeLow = episodeLow;
      sawFreshLow = false;
      peak = null;
      episodeLow = null;
      stopFired = false;
    }

    if (awaitingFill) {
      // The buy sent on the last batch did not fill (no bar, or past the
      // slippage cap): forget it and go back to watching for a setup.
      awaitingFill = false;
      peak = null;
      episodeLow = null;
    }

    // Flat. The kill switch: never open a new position from a deep hole.
    const start = BigInt(state.hello.capital.quote_units);
    if (state.equity * 10000n < start * BigInt(KILL_SWITCH_BPS)) return [];

    // The re-entry guard: after an episode, demand a fresh low first.
    if (lastEpisodeLow !== null && !sawFreshLow) {
      if (close < lastEpisodeLow) sawFreshLow = true;
      else return [];
    }

    // Look for the washout-reversal setup.
    const n = closes.length;
    if (n <= DRAWDOWN_LOOKBACK || n <= BREAKOUT_BARS) return [];
    const high = highest(closes, n - DRAWDOWN_LOOKBACK - 1, n);
    if ((high - close) * 10000 < DRAWDOWN_BPS * high) return [];
    if (close <= highest(closes, n - BREAKOUT_BARS - 1, n - 1)) return [];

    // Setup found: spend all the cash the position cap allows.
    const room = state.weightRoom(symbol);
    const notional = state.cash < room ? state.cash : room;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    peak = close;
    episodeLow = close;
    awaitingFill = true;
    const buy: OrderInput = { side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
