// WashoutTurn: a long-only cbBTC/USDC bot for the bars-replay/v1 harness,
// built for the 2026-11-18 24h race.
//
// What the last two race boards taught (public fields only: trade counts,
// drawdowns, titles): the paid places went to bots that traded two to four
// times in a day, kept drawdown near one percent, and bought only real
// sell-offs, while shallow-dip buyers ground themselves down with fees.
// A round trip here costs roughly 26 to 35 bps once the 4 bps fee, 2 bps
// of slippage and pool impact are counted, so a trade has to capture a
// genuine dislocation, not a wobble. Two more lessons shaped this design:
// a long reference window blinds a bot to the first hours of a window,
// where a young sell-off often offers its best bounce, and a dip that is
// still falling is a trap, not an entry. So:
//
//   - Dip measure: the pullback of the latest close under the highest
//     close of the last 180 bars. An entry needs that pullback to reach
//     1.05% — deep enough that the snap-back, when it comes, pays the
//     round-trip cost several times over.
//   - Turn confirmation: the close must already have lifted at least
//     0.10% off the lowest close of the last ten bars, and must be above
//     the previous close. The first leg down is never bought; the bot
//     pays a few bps of the bounce to learn that the selling stopped.
//   - One tranche, 98% of equity. Splitting the stake across a ladder
//     left yesterday's bot half-invested through the whole bounce; a
//     confirmed washout either snaps back or the stop decides, so the
//     size goes on at once.
//   - Exits are priced off the fill: take profit at 2.0% over the
//     blended entry, stop at 1.0% under it. A position still open after
//     420 bars leaves at the first close at or above its entry plus
//     0.1%, so a dead trade cannot squat on the stake all day.
//   - A stop-out starts a 180-bar sit-out, so one grinding slide cannot
//     be bought three times. Any other exit starts a 45-bar pause, and
//     no new entry is taken after bar 1380: a trade opened later cannot
//     finish its work before the window flattens everything anyway.
//   - If the window never washes out, a 10% probe at bar 1350, held to
//     the end, makes sure the bot still records a trade.
//
// Deterministic: float64 arithmetic over the bars' integers only, no
// clock, no randomness, no files, no network.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

const HIGH_SPAN = 180; // bars the rolling high is taken over
const DIP_PULLBACK = -0.0105; // entry needs a pullback of 1.05% or more
const TURN_SPAN = 10; // bars the turn is measured over (recent low)
const TURN_LIFT = 0.001; // close must be 0.10% above that low to count as turned
const SIZE_FRAC = 0.98; // share of equity the single tranche spends
const TAKE_PROFIT = 0.02; // exit 2.0% over the blended entry fill
const STOP_LOSS = 0.01; // exit 1.0% under the blended entry fill
const STALE_BARS = 420; // bars after which a flat trade is recycled
const STALE_MIN = 0.001; // stale exit needs the close 0.1% over the entry
const STOP_COOLDOWN = 180; // bars sat out after a stop-out
const EXIT_COOLDOWN = 45; // bars sat out after any other exit
const LAST_ENTRY_BAR = 1380; // no fresh entries after this bar
const PROBE_FROM = 1350; // first bar the probe may fire on
const PROBE_FRAC = 0.1; // share of equity the probe spends
const MAX_SLIPPAGE_BPS = 250;

/** Every CBBTC close seen so far, oldest first (raw price units). */
const closes: number[] = [];
/** Index of the bar being answered, counting CBBTC bars from 0. */
let barIndex = -1;
/** Filled buys so far this window. */
let fills = 0;
/** Quantity-weighted average price of the open position (raw units). */
let avgEntry = 0;
/** Quantity this bot's own fill tally says it holds (raw base units). */
let myQty = 0;
/** Bar index at which the open position's first fill landed. */
let entryBar = -1;
/** Whether the position still open is the probe (held to the end). */
let isProbe = false;
/** The buy last sent was the probe; applied when its fill lands. */
let sentProbe = false;
/** Entries are blocked while barIndex is below this bar. */
let blockedUntil = -1;

/** Highest close among the last n bars, the latest included. */
function recentHigh(n: number): number {
  let high = 0;
  for (let i = Math.max(0, closes.length - n); i < closes.length; i++) {
    if (closes[i] > high) high = closes[i];
  }
  return high;
}

/** Lowest close among the last n bars before (and excluding) the latest. */
function recentLow(n: number): number {
  let low = Infinity;
  for (let i = Math.max(0, closes.length - 1 - n); i < closes.length - 1; i++) {
    if (closes[i] < low) low = closes[i];
  }
  return low;
}

/** Fold a batch's fills into the position tally. */
function readFills(batch: Batch): void {
  for (const f of batch.fills) {
    if (f.symbol !== SYMBOL || f.status !== 'filled') continue;
    const q = Number(f.qty);
    const p = Number(f.price);
    if (f.side === 'buy') {
      fills++;
      avgEntry = myQty > 0 ? (avgEntry * myQty + p * q) / (myQty + q) : p;
      if (myQty === 0) {
        entryBar = barIndex;
        isProbe = sentProbe;
      }
      myQty += q;
      sentProbe = false;
    } else {
      myQty -= q;
      if (myQty <= 0) {
        myQty = 0;
        const stopped = avgEntry > 0 && p < avgEntry * (1 - STOP_LOSS / 2);
        blockedUntil = barIndex + (stopped ? STOP_COOLDOWN : EXIT_COOLDOWN);
        avgEntry = 0;
        entryBar = -1;
        isProbe = false;
      }
    }
  }
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    let fresh = false;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      barIndex++;
      closes.push(Number(bar.c));
      fresh = true;
    }
    readFills(batch);
    if (!fresh || state.warmingUp) return [];

    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null || closes.length < HIGH_SPAN) return [];
    const close = Number(closeRaw);
    const held = state.positions.get(SYMBOL);
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);

    const spendNow = (frac: number): bigint => {
      const want = (state.equity * BigInt(Math.round(frac * 10000))) / 10000n;
      const room = state.weightRoom(SYMBOL);
      let n = want < state.cash ? want : state.cash;
      if (room < n) n = room;
      return n;
    };

    if (held !== undefined && held.qty > 0n) {
      if (isProbe) return []; // the probe rides to the end of the window
      let exit = false;
      if (avgEntry > 0) {
        if (close >= avgEntry * (1 + TAKE_PROFIT)) exit = true;
        if (close <= avgEntry * (1 - STOP_LOSS)) exit = true;
        if (barIndex - entryBar >= STALE_BARS && close >= avgEntry * (1 + STALE_MIN)) exit = true;
      }
      if (exit) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat. The washout entry: a deep pullback that has started turning.
    if (barIndex >= blockedUntil && barIndex <= LAST_ENTRY_BAR && closes.length >= 2) {
      const pullback = close / recentHigh(HIGH_SPAN) - 1;
      if (pullback <= DIP_PULLBACK) {
        const low = recentLow(TURN_SPAN);
        const turned = close >= low * (1 + TURN_LIFT) && close > closes[closes.length - 2];
        if (turned) {
          const n = spendNow(SIZE_FRAC);
          if (n >= minNotional) {
            sentProbe = false;
            return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: n, max_slippage_bps: MAX_SLIPPAGE_BPS }];
          }
        }
      }
    }

    // Nothing has traded all window: leave a small probe so a trade exists.
    if (fills === 0 && barIndex >= PROBE_FROM) {
      const n = spendNow(PROBE_FRAC);
      if (n >= minNotional) {
        sentProbe = true;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: n, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
