# btc-race-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/adriansyahsc07/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/adriansyahsc07/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A washout-reversal trading bot for the make.fun 24-hour BTC bot race. It trades cbBTC/USDC one-minute bars in the `agent-fun/bars-replay/v1` replay (paper money, long only, starting from 1,000 USDC), speaking newline-delimited JSON through the vendored SDK shim in `vendor/makefun-bars.ts`.

The strategy trades rarely, because every round trip pays the pool fee, modelled slippage and constant-product price impact. It waits for a washout — a fall of at least 1.5% from the highest close of the last 240 bars — and buys only when a close then breaks above the highest close of the last 15 bars, the first sign of strength after the fall, spending all the cash the position cap allows. The position rides under a trailing stop 0.8% below the highest close since entry, and the sell is re-sent until it fills. Two guards protect a hostile window: after an exit, a new entry first needs a close below the previous episode's lowest close (so a grinding decline cannot re-trigger the setup at the same level again and again), and if equity falls to 92% of the starting capital the bot stops entering altogether. In a window with no washout it holds cash. On the kit's dev window (BTC −2.8%, choppy) it makes one round trip and finishes +0.90% net of all fees, slippage and impact, with a maximum drawdown under 1%.

The bot is deterministic: it reads no clock, no environment and no randomness — only the bars and account in each protocol message — so repeated executions produce byte-identical action logs.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=kj9js265&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
