# Backend-Managed Banners (CDN + `/v1/banners`)

Status: **Plan — not started**
Scope: promo carousel on the home and explore tabs
Owner surfaces: `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`, `reference/latch-api`

## Problem

The promo carousel ships its artwork inside the bundle:

```ts
// app/(tabs)/index.tsx and app/(tabs)/explore.tsx — identical arrays
const banners = [
  { id: 1, image: require('@/src/assets/banners/smart-accounts.png') },
  { id: 2, image: require('@/src/assets/banners/multisig.png') },
  { id: 3, image: require('@/src/assets/banners/swap.png') },
  { id: 4, image: require('@/src/assets/banners/session-keys.png') },
];
```

Consequences:

- Changing a banner costs an app release, or at best an OTA JS push (see
  `docs/ota-updates.md`). Marketing cadence is coupled to release cadence.
- There is no way to schedule a campaign, end one, or kill a bad banner without
  shipping.
- Banners advertise features (`session-keys` is "coming soon") with no way to
  target by app version, so a user on an old build can be shown a promo for a
  feature their binary doesn't contain — and no way to stop showing "coming
  soon" once it lands.
- The four PNGs are ~384 KB of bundle, `smart-accounts.png` alone 195 KB.
- The two screens duplicate the array and the carousel JSX.

**Goal:** a banner change becomes a database update. The CDN owns the bytes; the
backend owns which banners exist, their order, their live window, and who sees
them.

## Current-state facts this plan is built on

Verified before writing, not assumed:

| Fact | Where |
|---|---|
| `latch-api` is Gin + sqlc + Postgres + Redis | `reference/latch-api/cmd/server/main.go` |
| **No object storage of any kind** — config has `DATABASE_URL` and `REDIS_URL` only | `internal/config/config.go` |
| **No admin role** — `middleware/auth.go` provides `RequireAuth`, nothing more | `internal/middleware/auth.go` |
| Redis-cached public read endpoint precedent | `internal/handler/prices.go` (`/v1/prices`, 60 s cache) |
| Hard ≥80 % total coverage gate | `reference/latch-api/CLAUDE.md` |
| `expo-image` already a dependency (~55.0.9), unused by the carousels | `package.json:69` |
| React Query has **no** disk persistence | `src/api/client.ts` |
| Dismissal-flag convention already exists | `WELCOME_BANNER_SHOWN_PREFIX`, `src/constants/constants.ts:299` |

## Phase 1 — CDN + asset pipeline

**Cloudflare R2 behind `cdn.latch.finance`.** No egress fees, S3-compatible API,
and Cloudflare is already in the stack. Supabase Storage is the alternative
(Supabase still appears in `env.js` for hot-updater) but that dependency is
vestigial now that OTA runs on EAS Update — don't deepen it.

**Content-hashed, immutable object keys.**

```
banners/smart-accounts.a3f91c.webp        # 2x
banners/smart-accounts.a3f91c@3x.webp
```

Served with `Cache-Control: public, max-age=31536000, immutable`. New artwork is
a new URL, so there is never a purge step and never a stale-image bug. The short
TTL lives on the manifest, not the bytes.

**Format:** WebP at 2x and 3x. Masters are 1400×400 (3.5:1). Expect roughly a
70 % size cut versus the current PNGs.

Uploads in v1 are manual (`wrangler` or the R2 console). A backend upload
endpoint is Phase 4 and is not a prerequisite for anything else.

## Phase 2 — Backend: `GET /v1/banners`

Migration `000020_banners` (up/down, per the existing numbering) plus sqlc
queries in `internal/db/queries`.

### Table

| Column | Notes |
|---|---|
| `id` uuid, `slug` text unique | stable identity — the client keys dismissal off this |
| `image_url`, `image_url_dark` | dark variant nullable; null means use the light one |
| `width`, `height` int | client reserves exact space, no layout jump on load |
| `placement` text | `home` \| `explore` \| `all` |
| `sort_order` int | carousel order |
| `is_active` bool | kill switch |
| `starts_at`, `ends_at` timestamptz | nullable; scheduling |
| `min_app_version` text | don't promo a feature the binary lacks |
| `platforms` text[] | `{ios,android}` |
| `network` text | `testnet` \| `mainnet` \| `all` |
| `action_url` text | deep link on tap — the banners are currently inert |
| `dismissible` bool | the ✕ is baked into the artwork, so default true |
| `title`, `body` text | **nullable, unused in v1** — see "Baked-in text" below |

### Handler

Modelled on `internal/handler/prices.go`.

- **Public route — no `RequireAuth`.** Two reasons. It is non-sensitive, and the
  authed limiter shares a single `rl:sub` bucket across
  cosign/history/wck/push/memberships; adding a polled endpoint to that bucket
  makes the existing 429 problem worse rather than better.
- Redis-cache the serialized response ~5 min.
- Emit `ETag` and `Cache-Control: public, max-age=300`, so Cloudflare serves
  most requests from the edge and clients get 304s.
- Query params: `?placement=home&platform=ios&app_version=1.4.2`.
- Filtering (active, window, platform, version, network) happens server-side.
  The client renders what it is given, in the order given.
- Coverage gate: handler + service tests land in the same PR as the handler.

### Response

```json
{
  "banners": [
    {
      "id": "…",
      "slug": "smart-accounts",
      "imageUrl": "https://cdn.latch.finance/banners/smart-accounts.a3f91c.webp",
      "imageUrlDark": null,
      "width": 1400,
      "height": 400,
      "actionUrl": "latch://settings/security",
      "dismissible": true
    }
  ]
}
```

## Phase 3 — Mobile

1. `src/api/banners.ts` + a `useBanners(placement)` React Query hook,
   `staleTime` ~30 min.
2. Swap RN `Image` → `expo-image` with `cachePolicy="memory-disk"` and a
   `transition`. This is what makes cold start non-janky: the bytes survive on
   disk across launches even though the query cache does not.
3. Persist the manifest JSON in **AsyncStorage** (non-sensitive — SecureStore is
   for keys/mnemonics/tokens only) so launch #2 paints instantly and revalidates
   behind it.
4. Empty or failed fetch → render nothing and collapse the carousel. No spinner,
   no empty box.
5. Keep the four bundled PNGs as a fallback for exactly one release, then delete
   them from the bundle.
6. Dismissal: store dismissed slugs in AsyncStorage following the existing
   `WELCOME_BANNER_SHOWN_PREFIX` pattern.
7. Extract `src/components/shared/BannerCarousel.tsx`. Both screens already run
   identical arrays and near-identical JSX (`index.tsx` around the "Banner
   Carousel" block, `explore.tsx:313`); wiring the hook into two copies would
   double the divergence rather than fix it.

Per the repo's UI rule, this phase adds data-layer logic only — the visual
carousel stays as it renders today.

## Phase 4 — Admin control

This is the real gap: `latch-api` has no admin concept at all. Options:

1. **`role` claim + `RequireAdmin` middleware**, admins seeded from an env
   allowlist, then `POST`/`PATCH`/`DELETE /v1/banners` and a presigned-upload
   endpoint. ~half a day, and it unblocks every future admin surface.
2. Manage rows by SQL/migration. Zero new code, but every banner change is a
   deploy — which defeats most of the point.
3. Skip the DB entirely: a hand-edited `manifest.json` in R2 the app reads
   directly. Cheapest possible version; permanently gives up targeting,
   scheduling, and per-user logic.

**Recommendation: (1)** — but ship Phases 1–3 first with rows seeded by
migration. The mobile work is the long pole and does not depend on an admin UI
existing.

## Phase 5 — Analytics

`POST /v1/banners/:id/events` for impressions and taps. Without it you can
schedule campaigns but cannot tell whether any of them worked. Out of v1 scope,
but the reason to do it is that every other phase is only useful once you can
measure the result.

## Open decision: baked-in text

The supplied artwork has its copy rendered into the image ("Coming soon:
Delegate permissions with secure Session Keys"). That means:

- no localization,
- no true dark-mode variant — only a second full image,
- every copy tweak is a designer round-trip and a new upload.

The durable shape is: **backend sends copy + a background image, the client
composes them.** That is a larger change and does not belong in v1. But if it is
the destination, `title`/`body` should exist in the API from day one — hence
their presence in the schema above, unused. Deciding this later costs a
migration and a client release; deciding it now costs two nullable columns.

## Sequencing

| Phase | Depends on | Blocking? |
|---|---|---|
| 1 — R2 bucket + WebP conversion | — | blocks 2 |
| 2 — table, endpoint, tests | 1 (needs real URLs) | blocks 3 |
| 3 — mobile hook, expo-image, carousel extraction | 2 | — |
| 4 — admin role + write endpoints | 2 | — |
| 5 — analytics | 3 | — |

Phases 3 and 4 are independent of each other and can run in parallel.
