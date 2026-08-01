# doctor-of-credit-mcp

MCP is the better abstraction because an AI client can interpret the articles at request time instead of forcing them into a rigid API schema.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm run build
npm start
```

The process communicates using MCP over stdio. Configure an MCP client to run
`node /absolute/path/to/doctor-of-credit-mcp/dist/cli.js`.

The server currently provides:

- `list_categories()` retrieves every category from Doctor of Credit's
  WordPress API.
- `get_post(url_or_id)` retrieves a post by its positive integer WordPress ID
  or HTTPS Doctor of Credit article URL.
- `get_recent_posts(category?, limit?)` retrieves recent posts from WordPress,
  optionally filtered by a category slug returned by `list_categories`. The
  default limit is 10 and the maximum is 100.
- `search_posts(query, category?, after?, limit?)` searches WordPress article
  text and titles. `category` accepts a slug from `list_categories`, `after`
  accepts an ISO calendar date (`YYYY-MM-DD`) and excludes older publications,
  and `limit` defaults to 10 with a maximum of 100.
- `compare_offers(post_ids[])` retrieves between 1 and 10 unique posts by
  positive integer WordPress ID. It returns each article independently under
  `posts` and does not merge or infer offer terms. If some posts cannot be
  retrieved, successful articles remain available and each failure is reported
  with its requested ID under `failures`. If every retrieval fails, the tool
  returns an actionable MCP error without comparison data.
- `get_big_deals(limit?)` retrieves likely notable deal articles. The default
  limit is 10 and the maximum is 25.
- `find_bank_bonuses(bank?, state?, amount_min?)` retrieves up to 10 likely
  bank-bonus source articles. `bank` is an institution text signal, `state` is
  a two-letter USPS state or District of Columbia code (case-insensitive), and
  `amount_min` is a positive whole-dollar threshold up to $1,000,000.

Post tools return source-backed fields under `source`: the stable ID,
original URL, title, publication and modification timestamps, and cleaned
article text. Interpretive fields live separately under `derived`. The
server sets `derived.outdatedWarning` when the article has not been modified
for more than 180 days. This conservative threshold uses the only dependable
freshness signal available in the source contract—the modification timestamp—
and avoids inferring an offer-specific expiration date from prose. It is a
prompt to verify the source, not a claim that the offer is valid or expired.

`get_recent_posts` falls back to the global or category-specific RSS feed when
WordPress is unavailable or returns invalid data. RSS items use the same post
shape, but RSS does not publish a modification timestamp, so `modifiedAt` is
`null` for those results. Their outdated warning conservatively uses the
publication timestamp instead. The server does not persist retrieved content
or metadata.

`search_posts` uses WordPress search directly so relevance and all filters are
applied by the source. It does not fall back to the recent-post RSS feed,
because that feed cannot provide a complete or relevance-ranked search result.

`get_big_deals` applies a deterministic candidate policy to the 100 most recent
posts (using the existing RSS fallback when WordPress is unavailable). An
article qualifies when its cleaned title or text contains a dollar amount of at
least $500 or an amount of at least 50,000 immediately followed by “points” or
“miles.” Candidates are ordered by: number of qualifying signal types, largest
dollar mention, largest points/miles mention, publication date, then stable post
ID, all descending. The matched maxima and qualifying-signal count appear under
`derived.selectionSignals`; they are text-selection signals, not assertions
about an offer's value, availability, or validity. Every candidate otherwise
retains the shared source and warning contract.

`find_bank_bonuses` searches up to 100 WordPress results using the supplied
institution, the state's full name, and “bank bonus” as search terms. It then
keeps only articles whose cleaned title/text contains both “bonus” and a
banking term (`bank`, `banking`, `checking`, `savings`, `credit union`, or
`deposit account`). Optional filters must also appear in the source text: the
institution is matched case-insensitively, geography matches the full state
name or uppercase postal code, and the largest dollar mention must meet
`amount_min`. Results are ordered by publication date and stable ID, descending,
then capped at 10. Match booleans and the largest dollar mention live under
`derived.bankBonusSignals`; they identify candidate evidence only and do not
assert geographic eligibility, direct-deposit requirements, availability,
offer value, or current validity. Search failures return errors rather than
falling back to an incomplete recent-post feed.

Upstream HTTP, network, and response-validation failures are returned as
actionable MCP tool errors rather than empty or fabricated results.

## Development

```sh
npm run typecheck
npm test
```

Tests exercise behavior through an MCP client. Most use an in-memory MCP
transport with controlled upstream HTTP fixtures; a smoke test launches the
compiled stdio entry point.

## Planned tools

I’d next add higher-level research tools:
find_credit_card_offers(issuer?, card?, bonus_min?)
Those higher-level tools would search and collect likely articles, but let the connected model interpret restrictions, expiration dates, direct-deposit rules, and similar prose. Results should always include:
Original article URL
Publication and modification dates
Cleaned article text
An explicit distinction between source data and AI-derived fields
Warnings when an offer may be outdated
Internally, it can use the WordPress endpoint first, RSS as a fallback, and a small SQLite cache. No separate public REST service is necessary—the MCP server itself becomes the interface.
A TypeScript implementation using the official MCP SDK would make a clean local server that works over stdio, with optional remote HTTP support later.
