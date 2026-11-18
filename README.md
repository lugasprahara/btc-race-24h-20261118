# btc-race-24h-20261118

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/lugasprahara/btc-race-24h-20261118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/lugasprahara/btc-race-24h-20261118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

WashoutTurn is a long-only cbBTC/USDC trading bot for the bars-replay/v1 harness. Because every fill pays a 4 bps fee, 2 bps of slippage and constant-product price impact, a round trip costs roughly 26 to 35 bps, so the bot only trades genuine sell-offs: it measures the pullback of the latest close under the highest close of the last 180 one-minute bars and buys a single tranche of 98% of equity only when that pullback reaches 1.05% and the close has already lifted at least 0.10% off the lowest close of the last ten bars, so the first leg of a slide is never bought. Exits are priced off the fill — take profit at 2.0% over the blended entry, stop at 1.0% under it — with a 420-bar stale exit that recycles a dead trade at the first close at or above its entry plus 0.1%, a 180-bar sit-out after any stop-out, and a small end-of-window probe that guarantees the bot records a trade on a window that never washes out. On the published dev window it made +$21.93 on the $1,000 stake over 4 trades with a 0.63% maximum drawdown.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=aes5np1n&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
