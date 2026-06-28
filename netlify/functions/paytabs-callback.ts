import type { Config } from "@netlify/functions";
import { upsertPaymentReview } from "./_shared/payment-review";

type PayTabsPayload = Record<string, unknown>;

export default async (req: Request) => {
  const data = await readRequestData(req);
  const transactionReference = pickString(data, ["tran_ref", "tranRef", "transaction_ref", "transactionReference"]);
  const cartId = pickString(data, ["cart_id", "cartId"]);
  const responseStatus = pickString(data, [
    "payment_result.response_status",
    "paymentResult.responseStatus",
    "response_status",
    "responseStatus",
    "respStatus",
  ]).toUpperCase();
  const responseCode = pickString(data, [
    "payment_result.response_code",
    "paymentResult.responseCode",
    "response_code",
    "responseCode",
    "respCode",
  ]);
  const responseMessage = pickString(data, [
    "payment_result.response_message",
    "paymentResult.responseMessage",
    "response_message",
    "responseMessage",
    "respMessage",
  ]);
  const amount = pickString(data, ["cart_amount", "cartAmount", "amount"]);
  const currency = normaliseCurrency(pickString(data, ["cart_currency", "cartCurrency", "currency"]) || "SAR");
  const reviewId = cartId || transactionReference;
  const metadata = extractReviewMetadata(data, cartId || reviewId);

  if (reviewId) {
    await upsertPaymentReview({
      id: reviewId,
      cartId,
      tranRef: transactionReference,
      ...metadata,
      amount,
      currency,
      actualStatus: responseStatus,
      actualCode: responseCode,
      actualMessage: responseMessage,
      actualAccepted: responseStatus === "A",
      source: "paytabs-callback",
    });
  }

  console.info(
    "PayTabs callback",
    JSON.stringify({
      reviewId: reviewId || null,
      tranRef: transactionReference || null,
      status: responseStatus || null,
      code: responseCode || null,
    }),
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const config: Config = {
  path: "/api/paytabs-callback",
  method: ["GET", "POST"],
};

async function readRequestData(req: Request): Promise<PayTabsPayload> {
  const data: PayTabsPayload = {};
  const url = new URL(req.url);

  url.searchParams.forEach((value, key) => {
    data[key] = value;
  });

  if (req.method === "GET") return data;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const jsonData = (await req.json().catch(() => ({}))) as PayTabsPayload;

    return { ...data, ...jsonData };
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await req.formData().catch(() => null);

    formData?.forEach((value, key) => {
      data[key] = typeof value === "string" ? value : value.name;
    });
  }

  return data;
}

function pickString(data: PayTabsPayload, paths: string[]): string {
  for (const path of paths) {
    const value = pickPath(data, path);

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return "";
}

function pickPath(data: PayTabsPayload, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as PayTabsPayload)[key];
    }

    return undefined;
  }, data);
}

function extractReviewMetadata(data: PayTabsPayload, fallbackCustomerId: string): {
  customerId?: string;
  customerCountry?: string;
  cardType?: string;
  cardScheme?: string;
  cardCountry?: string;
} {
  return {
    customerId: pickString(data, ["customer_id", "customerId", "customer.id", "customerDetails.id"]) || fallbackCustomerId,
    customerCountry: normaliseCountry(
      pickString(data, [
        "customer_country",
        "customerCountry",
        "customer.country",
        "customerDetails.country",
        "billing_details.country",
        "billingDetails.country",
      ]),
    ),
    cardType: pickString(data, ["payment_info.card_type", "paymentInfo.cardType", "card_type", "cardType", "payment_info.payment_method"]),
    cardScheme: pickString(data, ["payment_info.card_scheme", "paymentInfo.cardScheme", "card_scheme", "cardScheme", "payment_info.card_brand"]),
    cardCountry: normaliseCountry(pickString(data, ["payment_info.card_country", "paymentInfo.cardCountry", "card_country", "cardCountry"])),
  };
}

function normaliseCurrency(value: string): string {
  const currency = value.toUpperCase();

  return /^[A-Z]{3}$/.test(currency) ? currency : "SAR";
}

function normaliseCountry(value: string): string | undefined {
  if (!value) return undefined;

  return value.toUpperCase();
}
