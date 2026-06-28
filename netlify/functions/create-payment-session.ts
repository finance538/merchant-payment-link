import type { Config, Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

type CheckoutPayload = {
  amount?: number | string;
  currency?: string;
};

type GenericCheckoutResponse = {
  checkoutUrl?: string;
  paymentUrl?: string;
  url?: string;
};

type PayTabsCheckoutResponse = {
  redirect_url?: string;
  tran_ref?: string;
  message?: string;
  code?: string | number;
};

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const payload = (await req.json().catch(() => ({}))) as CheckoutPayload;
  const amount = normaliseAmount(payload.amount);
  const currency = normaliseCurrency(payload.currency);

  if (amount === null) {
    return json({ error: "Invalid amount" }, 400);
  }

  const origin = getPublicOrigin(req);
  const successUrl = origin + "/success.html?amount=" + encodeURIComponent(amount.toFixed(2)) + "&currency=" + currency;
  const cancelUrl = origin + "/cancel.html?amount=" + encodeURIComponent(amount.toFixed(2)) + "&currency=" + currency;
  const provider = (Netlify.env.get("PAYMENT_PROVIDER") || "demo").toLowerCase();

  if (provider === "demo") {
    return json({ url: successUrl }, 200);
  }

  if (provider === "redirect") {
    const redirectBaseUrl = Netlify.env.get("PAYMENT_REDIRECT_BASE_URL");

    if (!redirectBaseUrl) {
      return json({ error: "PAYMENT_REDIRECT_BASE_URL is missing" }, 500);
    }

    const url = new URL(redirectBaseUrl);
    url.searchParams.set("amount", amount.toFixed(2));
    url.searchParams.set("currency", currency);
    url.searchParams.set("success_url", successUrl);
    url.searchParams.set("cancel_url", cancelUrl);

    return json({ url: url.toString() }, 200);
  }

  if (provider === "generic-json-api") {
    const apiUrl = Netlify.env.get("PAYMENT_API_URL");
    const apiKey = Netlify.env.get("PAYMENT_API_KEY");

    if (!apiUrl) {
      return json({ error: "PAYMENT_API_URL is missing" }, 500);
    }

    const upstreamResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
      },
      body: JSON.stringify({
        amount: amount.toFixed(2),
        amountMinor: Math.round(amount * 100),
        currency,
        successUrl,
        cancelUrl,
      }),
    });

    const upstreamData = (await upstreamResponse.json().catch(() => ({}))) as GenericCheckoutResponse;
    const checkoutUrl = upstreamData.checkoutUrl || upstreamData.paymentUrl || upstreamData.url;

    if (!upstreamResponse.ok || !checkoutUrl) {
      return json({ error: "Payment provider did not return a checkout URL" }, 502);
    }

    return json({ url: checkoutUrl }, 200);
  }

  if (provider === "paytabs") {
    const profileId = Netlify.env.get("PAYTABS_PROFILE_ID");
    const serverKey = Netlify.env.get("PAYTABS_SERVER_KEY");
    const apiUrl = Netlify.env.get("PAYTABS_API_URL") || "https://secure.paytabs.sa/payment/request";

    if (!profileId) {
      return json({ error: "PAYTABS_PROFILE_ID is missing" }, 500);
    }

    if (!serverKey) {
      return json({ error: "PAYTABS_SERVER_KEY is missing" }, 500);
    }

    const cartId = createCartId();
    const callbackUrl = Netlify.env.get("PAYTABS_CALLBACK_URL") || successUrl;
    const cartDescription = Netlify.env.get("PAYTABS_CART_DESCRIPTION") || "Merchant Payment Link";

    const payTabsResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: serverKey,
      },
      body: JSON.stringify({
        profile_id: profileId,
        tran_type: "sale",
        tran_class: "ecom",
        cart_id: cartId,
        cart_description: cartDescription,
        cart_currency: currency,
        cart_amount: amount.toFixed(2),
        callback: callbackUrl,
        return: successUrl,
        hide_shipping: true,
      }),
    });

    const payTabsData = (await payTabsResponse.json().catch(() => ({}))) as PayTabsCheckoutResponse;
    const checkoutUrl = payTabsData.redirect_url;

    if (!payTabsResponse.ok || !checkoutUrl) {
      const payTabsError = payTabsData.message || "PayTabs did not return a payment URL" + (payTabsData.code ? " (" + payTabsData.code + ")" : "");

      return json({ error: payTabsError }, 502);
    }

    return json({ url: checkoutUrl, tranRef: payTabsData.tran_ref }, 200);
  }

  return json({ error: "Unsupported PAYMENT_PROVIDER: " + provider }, 500);
};

export const config: Config = {
  path: "/api/create-payment-session",
  method: ["POST"],
};

function normaliseAmount(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;

  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));

  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.round(parsed * 100) / 100;
}

function normaliseCurrency(value: string | undefined): string {
  if (!value) return "SAR";

  const currency = value.toUpperCase();

  return /^[A-Z]{3}$/.test(currency) ? currency : "SAR";
}

function getPublicOrigin(req: Request): string {
  const configuredUrl = Netlify.env.get("PUBLIC_SITE_URL") || Netlify.env.get("URL");

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return new URL(req.url).origin;
}

function createCartId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);

  return "mpl-" + Date.now() + "-" + randomPart;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
