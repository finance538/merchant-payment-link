import type { Config, Context } from "@netlify/functions";
import { notifyMerchantEvent, upsertPaymentReview } from "./_shared/payment-review";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

type CheckoutPayload = {
  amount?: number | string;
  currency?: string;
  gateway?: string;
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

type TamaraCheckoutResponse = {
  checkout_deeplink?: string;
  checkout_url?: string;
  checkout_id?: string;
  order_id?: string;
  status?: string;
  message?: string;
  errors?: Array<{ error_code?: string; message?: string }>;
};

type TapChargeResponse = {
  id?: string;
  status?: string;
  message?: string;
  errors?: Array<{ code?: string; description?: string; message?: string }>;
  transaction?: {
    url?: string;
  };
  response?: {
    code?: string;
    message?: string;
  };
};

export default async (req: Request, context: Context) => {
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
  const customerIp = getClientIp(req, context);
  const successUrl = origin + "/success.html?amount=" + encodeURIComponent(amount.toFixed(2)) + "&currency=" + currency;
  const cancelUrl = origin + "/cancel.html?amount=" + encodeURIComponent(amount.toFixed(2)) + "&currency=" + currency;
  const provider = normaliseProvider(payload.gateway) || (Netlify.env.get("PAYMENT_PROVIDER") || "demo").toLowerCase();

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
    const callbackUrl = Netlify.env.get("PAYTABS_CALLBACK_URL") || origin + "/api/paytabs-callback";
    const returnUrl = origin + "/api/paytabs-return?amount=" + encodeURIComponent(amount.toFixed(2)) + "&currency=" + currency + "&cart_id=" + encodeURIComponent(cartId);
    const cartDescription = Netlify.env.get("PAYTABS_CART_DESCRIPTION") || "Merchant Payment Link";

    const review = await upsertPaymentReview({
      id: cartId,
      cartId,
      provider: "paytabs",
      gateway: "PayTabs",
      customerIp,
      customerId: cartId,
      amount: amount.toFixed(2),
      currency,
      actualStatus: "session_requested",
      actualAccepted: false,
      source: "created",
    });

    context.waitUntil(
      notifyMerchantEvent(review, origin, "paytabs-started", "Payment started", [
        "Stage: customer selected PayTabs and pressed Pay",
      ]).catch((error) => console.error("Unable to send PayTabs start notification", error)),
    );

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
        return: returnUrl,
        hide_shipping: true,
      }),
    });

    const payTabsData = (await payTabsResponse.json().catch(() => ({}))) as PayTabsCheckoutResponse;
    const checkoutUrl = payTabsData.redirect_url;

    if (!payTabsResponse.ok || !checkoutUrl) {
      const payTabsError = payTabsData.message || "PayTabs did not return a payment URL" + (payTabsData.code ? " (" + payTabsData.code + ")" : "");

      await upsertPaymentReview({
        id: cartId,
        cartId,
        provider: "paytabs",
        gateway: "PayTabs",
        customerIp,
        customerId: cartId,
        amount: amount.toFixed(2),
        currency,
        actualStatus: "session_failed",
        actualCode: payTabsData.code ? String(payTabsData.code) : undefined,
        actualMessage: payTabsError,
        actualAccepted: false,
        source: "created",
      });

      return json({ error: payTabsError }, 502);
    }

    await upsertPaymentReview({
      id: cartId,
      cartId,
      provider: "paytabs",
      gateway: "PayTabs",
      tranRef: payTabsData.tran_ref,
      customerIp,
      customerId: cartId,
      amount: amount.toFixed(2),
      currency,
      actualStatus: "checkout_created",
      actualAccepted: false,
      source: "created",
    });

    return json({ url: checkoutUrl, tranRef: payTabsData.tran_ref }, 200);
  }

  if (provider === "tap") {
    const secretKey = Netlify.env.get("TAP_SECRET_KEY");
    const apiUrl = (Netlify.env.get("TAP_API_URL") || "https://api.tap.company/v2/charges").replace(/\/$/, "");
    const sourceId = Netlify.env.get("TAP_SOURCE_ID") || "src_all";
    const customerEmail = Netlify.env.get("TAP_CUSTOMER_EMAIL") || "payments@example.com";
    const customerFirstName = Netlify.env.get("TAP_CUSTOMER_FIRST_NAME") || "Customer";
    const customerLastName = Netlify.env.get("TAP_CUSTOMER_LAST_NAME") || "Payment";
    const statementDescriptor = Netlify.env.get("TAP_STATEMENT_DESCRIPTOR") || "Merchant Payment";

    if (!secretKey) {
      return json({ error: "TAP_SECRET_KEY is missing" }, 500);
    }

    const cartId = createCartId();
    const returnUrl = origin + "/api/tap-return?amount=" + encodeURIComponent(amount.toFixed(2)) + "&currency=" + currency + "&cart_id=" + encodeURIComponent(cartId);
    const postUrl = origin + "/api/tap-webhook";
    const review = await upsertPaymentReview({
      id: cartId,
      cartId,
      provider: "tap",
      gateway: "Tap",
      customerIp,
      customerId: cartId,
      amount: amount.toFixed(2),
      currency,
      actualStatus: "INITIATED",
      actualAccepted: false,
      source: "created",
    });

    context.waitUntil(
      notifyMerchantEvent(review, origin, "tap-started", "Payment started", [
        "Stage: customer selected Tap and pressed Pay",
      ]).catch((error) => console.error("Unable to send Tap start notification", error)),
    );

    const tapBody: Record<string, unknown> = {
      amount: Number(amount.toFixed(2)),
      currency,
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      description: "Merchant Payment Link",
      statement_descriptor: statementDescriptor,
      metadata: {
        cart_id: cartId,
        provider: "merchant-payment-link",
      },
      reference: {
        transaction: cartId,
        order: cartId,
        idempotent: cartId,
      },
      receipt: {
        email: false,
        sms: false,
      },
      customer: {
        first_name: customerFirstName,
        last_name: customerLastName,
        email: customerEmail,
      },
      source: {
        id: sourceId,
      },
      post: {
        url: postUrl,
      },
      redirect: {
        url: returnUrl,
      },
    };
    const merchantId = Netlify.env.get("TAP_MERCHANT_ID");

    if (merchantId) {
      tapBody.merchant = { id: merchantId };
    }

    const tapResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + secretKey,
      },
      body: JSON.stringify(tapBody),
    });

    const tapData = (await tapResponse.json().catch(() => ({}))) as TapChargeResponse;
    const checkoutUrl = tapData.transaction?.url;

    if (!tapResponse.ok || !checkoutUrl) {
      const tapError = getTapError(tapData, tapResponse.status);

      await upsertPaymentReview({
        id: cartId,
        cartId,
        provider: "tap",
        gateway: "Tap",
        gatewayOrderId: tapData.id,
        customerIp,
        customerId: cartId,
        amount: amount.toFixed(2),
        currency,
        actualStatus: "session_failed",
        actualCode: tapData.response?.code,
        actualMessage: tapError,
        actualAccepted: false,
        source: "created",
      });

      return json({ error: tapError }, 502);
    }

    await upsertPaymentReview({
      id: cartId,
      cartId,
      provider: "tap",
      gateway: "Tap",
      gatewayOrderId: tapData.id,
      customerIp,
      customerId: cartId,
      amount: amount.toFixed(2),
      currency,
      actualStatus: tapData.status || "INITIATED",
      actualCode: tapData.response?.code,
      actualMessage: tapData.response?.message,
      actualAccepted: tapData.status === "CAPTURED",
      source: "created",
    });

    return json({ url: checkoutUrl, chargeId: tapData.id }, 200);
  }

  if (provider === "tamara") {
    const apiToken = Netlify.env.get("TAMARA_API_TOKEN") || Netlify.env.get("TAMARA_MERCHANT_KEY");
    const apiBaseUrl = (Netlify.env.get("TAMARA_API_URL") || "https://api.tamara.co").replace(/\/$/, "");
    const platform = Netlify.env.get("TAMARA_PLATFORM") || "ONESHOT_POS_QR";
    const locale = Netlify.env.get("TAMARA_LOCALE") || "en_US";
    const deviceId = Netlify.env.get("TAMARA_DEVICE_ID");

    if (!apiToken) {
      return json({ error: "TAMARA_API_TOKEN is missing" }, 500);
    }

    if (!deviceId) {
      return json({ error: "TAMARA_DEVICE_ID is missing. Add your Tamara POS device id in Netlify environment variables." }, 500);
    }

    const cartId = createCartId();
    const review = await upsertPaymentReview({
      id: cartId,
      cartId,
      provider: "tamara",
      gateway: "Tamara",
      customerIp,
      customerId: cartId,
      amount: amount.toFixed(2),
      currency,
      actualStatus: "session_requested",
      actualAccepted: false,
      source: "created",
    });

    context.waitUntil(
      notifyMerchantEvent(review, origin, "tamara-started", "Payment started", [
        "Stage: customer selected Tamara and pressed Pay",
      ]).catch((error) => console.error("Unable to send Tamara start notification", error)),
    );

    const tamaraResponse = await fetch(apiBaseUrl + "/checkout/in-store", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiToken,
        "X-Device-Id": deviceId,
      },
      body: JSON.stringify({
        amount: {
          amount: Number(amount.toFixed(2)),
          currency,
        },
        order_reference_id: cartId,
        order_number: cartId,
        platform,
        locale,
        additional_data: {
          store_code: Netlify.env.get("TAMARA_STORE_CODE") || "merchant-payment-link",
        },
      }),
    });

    const tamaraData = (await tamaraResponse.json().catch(() => ({}))) as TamaraCheckoutResponse;
    const checkoutUrl = tamaraData.checkout_deeplink || tamaraData.checkout_url;

    if (!tamaraResponse.ok || !checkoutUrl) {
      const tamaraError = getTamaraError(tamaraData, tamaraResponse.status);

      await upsertPaymentReview({
        id: cartId,
        cartId,
        provider: "tamara",
        gateway: "Tamara",
        gatewayOrderId: tamaraData.order_id,
        checkoutId: tamaraData.checkout_id,
        customerIp,
        customerId: cartId,
        amount: amount.toFixed(2),
        currency,
        actualStatus: "session_failed",
        actualMessage: tamaraError,
        actualAccepted: false,
        source: "created",
      });

      return json({ error: tamaraError }, 502);
    }

    await upsertPaymentReview({
      id: cartId,
      cartId,
      provider: "tamara",
      gateway: "Tamara",
      gatewayOrderId: tamaraData.order_id,
      checkoutId: tamaraData.checkout_id,
      customerIp,
      customerId: cartId,
      amount: amount.toFixed(2),
      currency,
      actualStatus: tamaraData.status || "checkout_created",
      actualAccepted: false,
      source: "created",
    });

    return json({ url: checkoutUrl, orderId: tamaraData.order_id, checkoutId: tamaraData.checkout_id }, 200);
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

function normaliseProvider(value: string | undefined): string {
  if (!value) return "";

  const provider = value.toLowerCase().trim();

  if (["paytabs", "tamara", "tap", "demo", "redirect", "generic-json-api"].includes(provider)) return provider;

  return "";
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

function getClientIp(req: Request, context: Context): string {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();

  return context.ip || forwardedFor || realIp || "";
}

function createCartId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);

  return "mpl-" + Date.now() + "-" + randomPart;
}

function getTamaraError(data: TamaraCheckoutResponse, status: number): string {
  const firstError = data.errors?.find((error) => error.message || error.error_code);

  return data.message || firstError?.message || firstError?.error_code || "Tamara did not return a checkout URL (HTTP " + status + ")";
}

function getTapError(data: TapChargeResponse, status: number): string {
  const firstError = data.errors?.find((error) => error.description || error.message || error.code);

  return data.message || firstError?.description || firstError?.message || firstError?.code || "Tap did not return a checkout URL (HTTP " + status + ")";
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
