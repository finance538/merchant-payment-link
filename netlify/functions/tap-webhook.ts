import type { Config } from "@netlify/functions";
import { notifyMerchantEvent, upsertPaymentReview } from "./_shared/payment-review";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

type TapPayload = Record<string, unknown>;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const origin = getPublicOrigin(req);
  const data = (await req.json().catch(() => ({}))) as TapPayload;
  const tapId = pickString(data, ["tap_id", "tapId", "charge_id", "chargeId", "id"]);
  const cartId = pickString(data, ["metadata.cart_id", "metadata.cartId", "reference.transaction", "reference.order", "cart_id", "cartId"]);
  const reviewId = cartId || tapId;

  if (!reviewId) {
    return json({ ok: false, error: "Missing Tap charge id" }, 400);
  }

  const status = pickString(data, ["status"]).toUpperCase();
  const responseCode = pickString(data, ["response.code", "gateway.response.code", "acquirer.response.code"]);
  const responseMessage = pickString(data, ["response.message", "gateway.response.message", "acquirer.response.message"]);
  const amount = pickString(data, ["amount"]);
  const currency = normaliseCurrency(pickString(data, ["currency"]) || "SAR");
  const metadata = extractReviewMetadata(data, reviewId);
  const review = await upsertPaymentReview({
    id: reviewId,
    cartId,
    provider: "tap",
    gateway: "Tap",
    gatewayOrderId: tapId,
    tranRef: tapId,
    ...metadata,
    amount,
    currency,
    actualStatus: status,
    actualCode: responseCode,
    actualMessage: responseMessage,
    actualAccepted: status === "CAPTURED",
    source: "tap-webhook",
  });

  await notifyMerchantEvent(review, origin, "tap-webhook-" + (status || "update"), "Tap payment update", [
    "Stage: Tap server webhook",
  ]);

  console.info(
    "Tap webhook",
    JSON.stringify({
      reviewId,
      tapId: tapId || null,
      status: status || null,
      code: responseCode || null,
    }),
  );

  return json({ ok: true }, 200);
};

export const config: Config = {
  path: "/api/tap-webhook",
  method: ["POST"],
};

function extractReviewMetadata(data: TapPayload, fallbackCustomerId: string): {
  customerId?: string;
  customerCountry?: string;
  cardType?: string;
  cardScheme?: string;
  cardCountry?: string;
} {
  return {
    customerId: pickString(data, ["customer.id"]) || fallbackCustomerId,
    customerCountry: normaliseCountry(pickString(data, ["customer.phone.country_code", "merchant.country"])),
    cardType: pickString(data, ["card.brand", "source.payment_type", "source.payment_method"]),
    cardScheme: pickString(data, ["card.scheme", "source.payment_method"]),
    cardCountry: normaliseCountry(pickString(data, ["card.country"])),
  };
}

function pickString(data: TapPayload, paths: string[]): string {
  for (const path of paths) {
    const value = pickPath(data, path);

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return "";
}

function pickPath(data: TapPayload, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as TapPayload)[key];
    }

    return undefined;
  }, data);
}

function normaliseCurrency(value: string): string {
  const currency = value.toUpperCase();

  return /^[A-Z]{3}$/.test(currency) ? currency : "SAR";
}

function normaliseCountry(value: string): string | undefined {
  if (!value) return undefined;

  return value.toUpperCase();
}

function getPublicOrigin(req: Request): string {
  const configuredUrl = Netlify.env.get("PUBLIC_SITE_URL") || Netlify.env.get("URL");

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return new URL(req.url).origin;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
