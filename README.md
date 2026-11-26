# Shopify Partner Ads

An embedded Shopify app for exchanging product advertising between stores. Merchants can promote their own products, display approved partners' products on their storefront, or enable both roles independently.

The project uses React Router 7, React 19, TypeScript, Shopify App Bridge and Polaris web components, with Prisma 6 and PostgreSQL for sessions and application data. A Liquid theme app extension renders the storefront advertising block.

## Features

- Independent advertiser and publisher roles, with niche and category preferences.
- Partner discovery, invitation links and connection codes.
- Directional partner permissions: both stores must approve each advertising direction. Approving one direction does not enable the reverse direction.
- Selection of up to 10 products for advertising, with product availability checks.
- A **Partner ads** theme app block that displays eligible partner products.
- Click-based credits: an accepted click transfers one credit from the advertiser to the publisher. Stores receive 20 one-time welcome credits; advertising pauses at zero balance.
- Balance history, advertising statistics and setup diagnostics.
- An operator console for blocking stores, hiding ads and granting promotional credits with a required reason.
- Product update/delete, uninstall, scope-update and privacy compliance webhook handlers.

The app does not implement payments, order tracking, customer profiles or tracking pixels.

## Project status

The core application is implemented. Release work is paused; full acceptance testing across multiple real stores and visual verification of the merchant dashboard remain incomplete. Production deployment, Docker and restore verification, and App Store review materials are deferred. The included Dockerfile is not evidence of a verified production deployment.

## Requirements

- Node.js 22.12 or later and npm.
- Shopify CLI available on your PATH.
- Access to a Shopify app and a development store; use two development stores to test partner advertising end to end.
- A running PostgreSQL database.

On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1`. Changing the system execution policy is unnecessary.

## Local development

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Copy [.env.example](.env.example) to `.env`. Set `DATABASE_URL`, `OPERATOR_USER`, and independent random values of at least 32 characters for `CLICK_TOKEN_SECRET`, `BONUS_RETENTION_SECRET` and `OPERATOR_PASSWORD`. Keep secrets out of version control and retain the same bonus secret across reinstalls.

3. Generate Prisma Client and apply database migrations:

   ```sh
   npm run setup
   ```

4. The checked-in `shopify.app.toml` is already linked to the owner's app. To work with a different app, link your own configuration:

   ```sh
   npm run config:link
   ```

5. Start development, replacing the example domain with your development store:

   ```sh
   npm run dev -- --store your-store.myshopify.com
   ```

6. Open the app using the link provided by Shopify CLI.

The development startup runs `scripts/prepare-prisma.mjs` and applies migrations before starting React Router. Shopify CLI supplies the Shopify credentials and app URL to its development process. Separate server or maintenance processes need their own environment configuration.

The checked-in application and callback URLs use `https://example.com` placeholders. Automatic development URL updates are enabled. Set actual hosted URLs before preparing a production release.

### Testing with two stores

Keep two `shopify app dev` processes running, one per development store. Development URL updates are isolated to the selected store; an expired tunnel for the other store can cause HTTP 500 responses at `/apps/partner-ads/ads`. See Shopify's [local testing documentation](https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally).

Start the first process normally. In a second PowerShell terminal, use a different store and a free theme extension port:

```powershell
$env:SHOPIFY_REUSE_PRISMA_CLIENT = '1'
npm.cmd run dev -- --store second-store.myshopify.com --theme-app-extension-port 9495
```

Enter the storefront password when prompted by the CLI. The reuse option verifies the generated Prisma Client version and schema without overwriting the DLL used by the first server. On Windows, avoid regenerating Prisma Client while a server is using it. After changing the schema or Prisma version, stop both processes, run `npm.cmd run setup`, and restart them.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for application data and Shopify sessions. |
| `SHOPIFY_API_KEY` | Shopify app client ID; supplied to the development process by Shopify CLI. |
| `SHOPIFY_API_SECRET` | Shopify app secret; supplied to the development process by Shopify CLI. |
| `SHOPIFY_APP_URL` | Public application URL for the current environment. |
| `SCOPES` | Configured scopes: `read_products,write_app_proxy`. |
| `CLICK_TOKEN_SECRET` | Secret used to protect click tokens; at least 32 characters. |
| `BONUS_RETENTION_SECRET` | Secret used to recognize previous welcome-credit grants across reinstalls; at least 32 characters. Keep it stable. |
| `OPERATOR_USER` | HTTP Basic username for `/operator`. |
| `OPERATOR_PASSWORD` | Operator password; at least 32 characters. |
| `SHOPIFY_APP_STORE_URL` | Optional HTTPS listing URL on `apps.shopify.com`, used for installation from invitation pages. |
| `SHOPIFY_REUSE_PRISMA_CLIENT` | Set to `1` to reuse a compatible generated Prisma Client for a second development process. |
| `TEST_DATABASE_URL` | Dedicated, migrated PostgreSQL database for integration tests. |

## Merchant workflow

1. In **Home**, choose a primary niche and enable the advertiser role, publisher role, or both.
2. In **My products**, select and verify the products you want to advertise.
3. In **Partners**, choose publisher categories and approve stores that may display your products. Use the directory or invitations to connect with partners.
4. In **Display partners**, choose advertiser categories and approve stores whose products may appear on your storefront.
5. As a publisher, manually add the **Partner ads** app block in Shopify's Theme Editor and save the theme.
6. Use **Balance and statistics** to review credits and activity.

Each advertising direction requires compatible categories, enabled roles and mutual permissions. The advertiser also needs a positive balance and eligible products.

The storefront block requires both marketing and analytics permission through Shopify's Customer Privacy API. It stays hidden when permission is unavailable, no eligible products exist, or loading fails. Products are checked again before offers and clicks are accepted.

Invitation pages use `SHOPIFY_APP_STORE_URL` for new installations. Without that setting, they show a connection code for stores that already have the app, but do not offer a new installation.

## Project structure

```text
app/
  components/              Shared merchant UI
  routes/                  Merchant pages, invitations, operator, proxy and webhooks
  services/                Partners, products, credits, ads, statistics and maintenance
  db.server.ts             Prisma client
  shopify.server.ts        Shopify authentication and session configuration
extensions/partner-ads/
  blocks/                  Liquid theme app block
  assets/                  Storefront JavaScript and CSS
prisma/                    Database schema and migrations
scripts/                   Prisma preparation, database tests and maintenance build
tests/                     Database integration and storefront tests
```

The storefront uses the `/apps/partner-ads` app proxy, mapped to `/proxy` routes. The operator console is available at `/operator` and uses HTTP Basic authentication and CSRF protection.

## Validation

```sh
npm run typecheck
npm run lint
npm run build
npm run test:storefront
```

Database integration tests require a dedicated test database with migrations applied. Set `TEST_DATABASE_URL` to that database, then run:

```sh
npm run test:db
```

The test runner refuses to start without `TEST_DATABASE_URL`. Tests exercise real PostgreSQL transactions and create and remove their own records. Shopify responses are mocked. Coverage includes credit concurrency and duplicate clicks, partner permissions, product limits, access revocation, moderation, welcome credits and reinstalls, deletion, authentication and operator protection.

Storefront tests cover block visibility, privacy consent, safe card rendering and rejection of synthetic clicks. They do not replace browser-based visual checks or acceptance testing on Shopify stores.

### Optional local PostgreSQL helper on Windows

`scripts/local-db.ps1` supports an existing portable PostgreSQL setup under `.cache/postgres`; it does not download or initialize PostgreSQL. Its `Start` action uses `127.0.0.1:15432`. Its `Test` action reads the database URL from the ignored `.cache/postgres/connection.json`, applies migrations and runs the integration tests. Ensure that URL points to a dedicated test database.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 Test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 Stop
```

## Build and maintenance

`npm run build` builds both the web application and the maintenance entry point. `npm run start` serves the built web application. `npm run docker-start` applies migrations before starting the server.

After building, run maintenance with:

```sh
npm run maintenance
```

Maintenance refreshes selected products for active, unblocked stores and removes expired click tokens, invitations and rate-limit records, plus webhook receipts older than 30 days. Supply the database and Shopify environment variables explicitly; values injected into a running CLI development process are not inherited by a separate maintenance process.

`npm run deploy` deploys Shopify app configuration and extensions. Hosting the web application and database is a separate step; see Shopify's [hosting deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service).

## Further documentation

- [DECISIONS.md](DECISIONS.md): architecture and implementation tradeoffs.
- [DB_SCHEMA.md](DB_SCHEMA.md): data models and transaction design.
- [AGENTS.md](AGENTS.md): repository instructions for coding agents, including use of the Shopify AI Toolkit.
