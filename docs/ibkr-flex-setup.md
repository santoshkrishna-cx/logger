# IBKR Flex setup for Tradelog

Tradelog reads two saved Flex queries through IBKR's Flex Web Service. Both are read-only; nothing in Tradelog can place orders or move money.

## 1. Name the sub-accounts

In IBKR Portal, set the account alias of each sub-account so imports match without any mapping:

| Person  | Alias       |
| ------- | ----------- |
| Santosh | `anilsub02` |
| Anil    | `anilsub01` |

If the aliases can't be set, the first file import asks which U-number belongs to whom and remembers the answer.

## 2. Create the two queries (from the master account)

Performance & Reports > Flex Queries.

**Trade Confirmation Flex Query** (same-day fills)
- Sections: Trade Confirmations > Executions, select all fields
- Period: Today
- Format: XML
- Accounts: anilsub01 and anilsub02

**Activity Flex Query** (next-morning official numbers)
- Sections: Trades (Executions, all fields), Cash Report (Base summary), Net Asset Value (NAV) in Base, Open Positions (Summary)
- Period: Last Business Day
- Format: XML, date format yyyyMMdd, time format HHmmss, date/time separator `;`
- Accounts: anilsub01 and anilsub02

Note each query's numeric Query ID.

> Open question: some account structures need one query per sub-account. If a single query only returns one account, create a second pair and add their IDs; the sync merges them.

## 3. Turn on the Flex Web Service

Settings > Account Settings > Reporting > Flex Web Service. Generate a token with **Expire After = 1 year** and **Valid For IP Address = the server's static IP**. Put it in `.env`:

```
FLEX_TOKEN=...
FLEX_TRADE_CONFIRM_QUERY_ID=...
FLEX_ACTIVITY_QUERY_ID=...
```

Set a calendar reminder 30 days before the token expires. If it lapses, file import on the Import page still works.

## What runs when

| Job | Schedule (ET) | Gives the log |
| --- | --- | --- |
| Trade Confirmation | Every 15 min, 9:30 to 16:45, weekdays | Same-day fills (IBKR lags 5 to 10 minutes) |
| Activity | 06:00, Tuesday to Saturday | IBKR realized P&L per fill, opening cash, account value, open positions with market value |

IBKR limits the Flex Web Service to 1 request per second and 10 per minute per token; the worker stays well under that.
