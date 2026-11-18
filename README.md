
## What this actually is

A live index of the Ascend launchpad. It watches the chain directly, stores every pool and trade in SQLite, and posts Discord embeds the moment something launches or trades. Right now the DB only holds 2 pools because `START_BLOCK` is set to `422319` — the contract deploy block — so a full historical index would need to crawl roughly **7.8 million blocks at 10k logs/request**, which is thousands of RPC calls on a public endpoint that rate-limits. That's why you only see STONKLY and Pumper. Lowering `MIN_TRADE_QUOTE` to `0.05` (done) makes trade embeds fire for everything already tracked, but it doesn't create history that was never indexed.

The real decision is whether this becomes a *breadth* product (all launches, all trades, historical backfill) or a *depth* product (live-only, accurate, fast). Breadth is what gets you a salary conversation with Ascend; depth is what keeps it free to host. If you want, next I can add a `BACKFILL` command that walks historical launches in the background at a safe rate and grows the pool list over a few hours.
