# Rasch o Q Design — website + shop

The existing 5-page bilingual (SV/EN) site, plus a working shop: product grid and detail pages,
cart, checkout, orders saved in a database, stock control, Stripe payment, order emails and an admin
(orders + products). Design, fonts, colours and the SV/EN switch are the site's own.

```
server/            Node backend (no dependencies to install)
public/            The website (your existing pages + new shop pages + /admin/)
data/              Database + uploaded images (created on first start; NOT in git; back it up)
test/              Automated end-to-end tests (npm test)
.env.example       Every setting, explained
```

## Run it locally (2 minutes)

Requires **Node 22.13 or newer** (`node -v`). There is nothing to `npm install`.

```bash
cp .env.example .env            # then open .env; the defaults work for a first try
npm run create-admin -- you@example.com     # asks for a password (12+ characters)
npm run seed                    # optional: 4 clearly-labelled SAMPLE watches
npm start                       # http://localhost:3000   (admin: http://localhost:3000/admin/)
```

Copy your existing `assets/` folder (hero video, brand logos, gallery photos) into `public/assets/`.
It merges with `public/assets/images/shop/` (the placeholder watch drawings used by the sample products).

## What still needs to be connected (nothing is faked)

| Feature | Works without it? | To turn it on |
|---|---|---|
| **Database** | Built in (SQLite file in `data/`) | Nothing. Host needs a *persistent disk* and backups. |
| **Payment (Stripe)** | Yes, in *manual mode*: orders are saved as **unpaid**; you confirm payment in the admin (“Mark payment received”). | Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (below). |
| **Confirmation emails** | Orders work; emails are skipped and logged on each order. | Set `RESEND_API_KEY` + `MAIL_FROM` (below). |
| **Shipping prices / countries** | Defaults in `.env.example` are placeholders. | Edit `SHIPPING_RATES`, `FREE_SHIPPING_OVER`. |

**Stripe**
1. Create a Stripe account, copy the *secret key* (`sk_test_…` while testing) into `.env`.
2. Dashboard → Developers → Webhooks → add endpoint `https://YOUR-DOMAIN/api/webhooks/stripe`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`. Copy its signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
3. Enable the payment methods you want (cards, Klarna, Swish…) in the Stripe dashboard. The shop uses Stripe Checkout,
   so card details never touch your server. An order becomes **Paid** only when Stripe confirms.

**Email (Resend)** — create an account, verify your sending domain, create an API key. Set `MAIL_FROM`
(e.g. `Rasch o Q Design <order@yourdomain.se>`). Set `ORDER_NOTIFY_EMAIL` to also get a mail for each order.

## Test a real order, start to finish

1. Start the app with **Stripe test keys**. Locally, forward webhooks with the Stripe CLI:
   `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (it prints the `whsec_…` to use).
2. Open `/butik.html`, add a watch, go to the cart, check out.
3. On Stripe's page pay with card `4242 4242 4242 4242` (any future date, any CVC).
   You land on the confirmation page; the order flips to **Paid** within seconds.
4. In `/admin/` open the order → set **Processing → Shipped** (add a tracking number). Check stock on the product.
5. Failure paths: use card `4000 0000 0000 0002` (declined, retry on Stripe's page) or press Back on Stripe's page:
   the order is released and the stock returns.

`npm test` runs 22 automated tests of the whole flow against a fake Stripe and fake email service.

## Admin (`/admin/`)

* **Orders**: search (number, name, email, phone), filter by status, open an order, change status
  (Pending / Paid / Processing / Shipped / Delivered / Cancelled), tracking number, history, emails sent.
* **Products**: add/edit watches, price (SEK incl. VAT), stock (per variant if you use variants), images
  (upload, reorder), Swedish + English texts, specifications, **Visible in the shop** on/off.
* Rules the server enforces: an order can't be Paid/Processing/Shipped/Delivered until payment is confirmed;
  cancelled orders can't be reopened; cancelling returns stock; a cancelled order that was already paid shows a
  “refund required” warning (refunds are done in the Stripe dashboard).

## Before you go live

- [ ] Replace or delete the sample products (their names end in “(exempel)”). Use real photos.
- [ ] Read and finish `public/villkor.html` (terms, returns, privacy). It is a **draft** with a visible banner; get it reviewed.
- [ ] Confirm VAT treatment for the prices you enter (prices are shown as final prices).
- [ ] Host on something that runs Node **and keeps a disk** (Render/Fly/Railway with a volume, or a VPS). Static hosts (Netlify, GitHub Pages) cannot run this backend.
- [ ] Set `NODE_ENV=production`, `PUBLIC_URL=https://…`, a long `SECRET_KEY`, `TRUST_PROXY=1` behind a proxy. Serve over HTTPS.
- [ ] Set up daily backups of `data/` (database + uploaded images).
- [ ] Switch Stripe from test to live keys and re-create the webhook with the live secret.
- [ ] The contact form still posts to your Formspree endpoint (unchanged).

## Security notes

Prices, totals, shipping and stock are always calculated on the server from the database; the browser only sends product
ids, variants and quantities. Orders + stock reservation happen in one database transaction; repeated submits
(double-click / retry) are de-duplicated with an idempotency key. Admin uses a server-side session cookie
(HttpOnly, SameSite=Strict), CSRF tokens, scrypt password hashes and login rate limits. Customers can only view an
order with its unguessable link. Secrets live in environment variables and never reach the browser. Customer
details are stored in the database file on your server's disk (file mode 600) — use disk-level encryption from your host
if you need encryption at rest; they are searchable in the admin, so they are not encrypted field by field.
Unpaid online orders release their stock after 45 minutes (`UNPAID_ORDER_TTL_MINUTES`).

## Good to know

* Stock for products **with variants** is tracked per variant; the product-level number is their sum.
* Currency is one per shop (`STORE_CURRENCY`, default SEK). Prices are stored as whole öre.
* One server process is assumed (SQLite). That is plenty for a workshop shop; for several servers, move to Postgres.
* The admin interface is in English; the shop and emails are Swedish/English by the customer's language choice.
