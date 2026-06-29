# Merchant Payment Link for Netlify

A small Arabic RTL payment-link site for Netlify.

What it does:

- Client pages are English-only.
- Client page shows only the amount and a Pay Now button.
- No customer name field.
- No customer email field.
- No customer phone field.
- Public amount page lets the customer enter the amount only and starts checkout directly.
- Netlify Function creates the checkout session server-side.
- Demo mode works immediately after deployment.
- PayTabs Hosted Payment Page is supported through server-side environment variables.
- Tamara checkout is supported through server-side environment variables.
- Tap hosted payment page is supported through server-side environment variables.
- Merchant review waits up to 20 seconds, except rejected gateway payments which are rejected automatically.
- Telegram alerts send a direct control-panel link for the specific payment.

## Pages

- `/` or `/pay?amount=100&currency=SAR` - customer payment page
- `/merchant` - public amount entry page that starts checkout directly
- `/control` - merchant control panel for payment review
- `/success.html` - success page
- `/cancel.html` - cancelled payment page
- `/pending.html` - pending manual review page

## Netlify setup

Build command:

```bash
npm run build
```

Publish directory:

```bash
public
```

Functions directory:

```bash
netlify/functions
```

## Environment variables

The project runs in demo mode by default.

For PayTabs, add these variables in Netlify:

- `PAYMENT_PROVIDER=paytabs`
- `PAYTABS_PROFILE_ID=your_paytabs_profile_id`
- `PAYTABS_SERVER_KEY=your_paytabs_server_key`
- `PAYTABS_API_URL=https://secure.paytabs.sa/payment/request`
- `PUBLIC_SITE_URL=https://merchant-payment-link.netlify.app`
- `CONTROL_PANEL_TOKEN=use_a_private_random_token`

Optional PayTabs variables:

- `PAYTABS_CART_DESCRIPTION=Merchant Payment Link`
- `PAYTABS_CALLBACK_URL=https://merchant-payment-link.netlify.app/api/paytabs-callback`
- `PAYTABS_QUERY_URL=https://secure.paytabs.sa/payment/query`

For Tamara, add these variables in Netlify:

- `TAMARA_API_URL=https://api.tamara.co`
- `TAMARA_API_TOKEN=your_tamara_merchant_key`
- `TAMARA_NOTIFICATION_TOKEN=your_tamara_notification_token`
- `TAMARA_DEVICE_ID=your_tamara_pos_device_id`
- `TAMARA_PLATFORM=ONESHOT_POS_QR`
- `TAMARA_LOCALE=en_US`
- `PUBLIC_SITE_URL=https://merchant-payment-link.netlify.app`

For Tap, add these variables in Netlify:

- `TAP_SECRET_KEY=your_tap_secret_key`
- `TAP_API_URL=https://api.tap.company/v2/charges`
- `TAP_SOURCE_ID=src_all`
- `TAP_CUSTOMER_EMAIL=payments@example.com`
- `TAP_STATEMENT_DESCRIPTOR=Merchant Payment`
- `PUBLIC_SITE_URL=https://merchant-payment-link.netlify.app`

Optional Tap variables:

- `TAP_MERCHANT_ID=your_tap_merchant_id`
- `TAP_CUSTOMER_FIRST_NAME=Customer`
- `TAP_CUSTOMER_LAST_NAME=Payment`

Optional Telegram variables for merchant alerts:

- `TELEGRAM_BOT_TOKEN=your_telegram_bot_token`
- `TELEGRAM_CHAT_ID=your_telegram_chat_id`

For a generic JSON provider instead of PayTabs:

- `PAYMENT_PROVIDER=generic-json-api`
- `PAYMENT_API_URL=https://your-provider.example/create-session`
- `PAYMENT_API_KEY=your_secret_key`
- `PUBLIC_SITE_URL=https://your-site.netlify.app`

The generic API should return JSON with one of these fields:

```json
{
  "checkoutUrl": "https://payment-page.example/session/123"
}
```

You can also use `url` or `paymentUrl` instead of `checkoutUrl`.

## Important

Never put payment API keys in browser JavaScript. Put secrets only in Netlify environment variables.
