# Merchant Payment Link for Netlify

A small Arabic RTL payment-link site for Netlify.

What it does:

- Client page shows only the amount and a Pay Now button.
- No customer name field.
- No customer email field.
- No customer phone field.
- Merchant page creates a link using amount only.
- Netlify Function creates the checkout session server-side.
- Demo mode works immediately after deployment.
- PayTabs Hosted Payment Page is supported through server-side environment variables.

## Pages

- `/` or `/pay?amount=100&currency=SAR` - customer payment page
- `/merchant` - merchant link generator
- `/success.html` - success page
- `/cancel.html` - cancelled payment page

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

Optional PayTabs variables:

- `PAYTABS_CART_DESCRIPTION=Merchant Payment Link`
- `PAYTABS_CALLBACK_URL=https://merchant-payment-link.netlify.app/success.html`

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
