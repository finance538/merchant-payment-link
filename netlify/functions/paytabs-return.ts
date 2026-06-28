import type { Config } from "@netlify/functions";
import {
  notifyMerchantIfAway,
  upsertPaymentReview,
  waitForManualDecision,
  type ManualDecision,
} from "./_shared/payment-review";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

type PayTabsPayload = Record<string, unknown>;

export default async (req: Request) => {
  const requestUrl = new URL(req.url);
  const origin = getPublicOrigin(req);
  const incomingData = await readRequestData(req);
  const transactionReference = pickString(incomingData, ["tran_ref", "tranRef", "transaction_ref", "transactionReference"]);
  const queryData = transactionReference ? await queryPayTabsTransaction(transactionReference) : null;
  const resultData = queryData || incomingData;
  const responseStatus = getResponseStatus(resultData) || getResponseStatus(incomingData);
  const responseCode = getResponseCode(resultData) || getResponseCode(incomingData);
  const responseMessage = getResponseMessage(resultData) || getResponseMessage(incomingData);
  const amount = pickString(resultData, ["cart_amount", "cartAmount", "amount"]) || requestUrl.searchParams.get("amount") || "";
  const currency = pickString(resultData, ["cart_currency", "cartCurrency", "currency"]) || requestUrl.searchParams.get("currency") || "SAR";
  const cartId = pickString(resultData, ["cart_id", "cartId"]) || requestUrl.searchParams.get("cart_id") || "";
  const reviewId = cartId || transactionReference || createFallbackReviewId();
  const actualAccepted = responseStatus === "A";
  const actualPending = isPendingResponse(responseStatus);
  const autoRejected = isRejectedResponse(responseStatus);
  const metadata = extractReviewMetadata(resultData, cartId || reviewId);

  const review = await upsertPaymentReview({
    id: reviewId,
    cartId,
    tranRef: transactionReference,
    ...metadata,
    amount,
    currency: normaliseCurrency(currency),
    actualStatus: responseStatus,
    actualCode: responseCode,
    actualMessage: responseMessage,
    actualAccepted,
    source: "paytabs-return",
  });

  await notifyMerchantIfAway(review, origin);

  const decision = autoRejected ? null : await waitForManualDecision(reviewId, 20000);
  const redirectUrl = buildRedirectUrl(origin, {
    id: reviewId,
    amount,
    currency: normaliseCurrency(currency),
    transactionReference,
    responseStatus,
    responseCode,
    responseMessage,
    actualAccepted,
    actualPending,
    decision,
  });

  console.info(
    "PayTabs return",
    JSON.stringify({
      reviewId,
      tranRef: transactionReference || null,
      status: responseStatus || null,
      code: responseCode || null,
      accepted: actualAccepted,
      autoRejected,
      decision: decision?.status || "auto",
    }),
  );

  return Response.redirect(redirectUrl.toString(), 302);
};

export const config: Config = {
  path: "/api/paytabs-return",
  method: ["GET", "POST"],
};

function buildRedirectUrl(
  origin: string,
  data: {
    id: string;
    amount: string;
    currency: string;
    transactionReference: string;
    responseStatus: string;
    responseCode: string;
    responseMessage: string;
    actualAccepted: boolean;
    actualPending: boolean;
    decision: ManualDecision | null;
  },
): URL {
  let targetPath = data.actualAccepted ? "/success.html" : data.actualPending ? "/pending.html" : "/cancel.html";
  let message = data.responseMessage;

  if (data.decision?.status === "success") {
    targetPath = "/success.html";
    message = data.decision.reason || message;
  }

  if (data.decision?.status === "failed") {
    targetPath = "/cancel.html";
    message = data.decision.reason || "The payment was not completed after merchant review.";
  }

  if (data.decision?.status === "pending") {
    targetPath = "/pending.html";
    message = data.decision.reason || "The payment is under review.";
  }

  if (data.decision?.status === "error") {
    targetPath = "/error.html";
    message = data.decision.reason || "A network or payment processing issue occurred.";
  }

  const redirectUrl = new URL(targetPath, origin);

  if (data.amount) redirectUrl.searchParams.set("amount", data.amount);
  redirectUrl.searchParams.set("currency", data.currency);
  redirectUrl.searchParams.set("review_id", data.id);
  if (data.transactionReference) redirectUrl.searchParams.set("tran_ref", data.transactionReference);
  if (data.responseStatus) redirectUrl.searchParams.set("status", data.responseStatus);
  if (data.responseCode) redirectUrl.searchParams.set("code", data.responseCode);
  if (message) redirectUrl.searchParams.set("message", message);
  if (data.decision) redirectUrl.searchParams.set("manual", data.decision.status);

  return redirectUrl;
}

async function queryPayTabsTransaction(transactionReference: string): Promise<PayTabsPayload | null> {
  const profileId = Netlify.env.get("PAYTABS_PROFILE_ID");
  const serverKey = Netlify.env.get("PAYTABS_SERVER_KEY");
  const queryUrl = getPayTabsQueryUrl();

  if (!profileId || !serverKey || !queryUrl) return null;

  const response = await fetch(queryUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: serverKey,
    },
    body: JSON.stringify({
      profile_id: profileId,
      tran_ref: transactionReference,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as PayTabsPayload;

  return response.ok ? data : null;
}

function getPayTabsQueryUrl(): string {
  const configuredUrl = Netlify.env.get("PAYTABS_QUERY_URL");

  if (configuredUrl) return configuredUrl;

  const requestUrl = Netlify.env.get("PAYTABS_API_URL") || "https://secure.paytabs.sa/payment/request";

  return requestUrl.replace(/\/request\/?$/, "/query");
}

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

function getResponseStatus(data: PayTabsPayload): string {
  return pickString(data, [
    "payment_result.response_status",
    "paymentResult.responseStatus",
    "response_status",
    "responseStatus",
    "respStatus",
  ]).toUpperCase();
}

function getResponseCode(data: PayTabsPayload): string {
  return pickString(data, [
    "payment_result.response_code",
    "paymentResult.responseCode",
    "response_code",
    "responseCode",
    "respCode",
  ]);
}

function getResponseMessage(data: PayTabsPayload): string {
  return pickString(data, [
    "payment_result.response_message",
    "paymentResult.responseMessage",
    "response_message",
    "responseMessage",
    "respMessage",
  ]);
}

function isRejectedResponse(status: string): boolean {
  if (!status) return false;

  return !["A", "H", "P"].includes(status);
}

function isPendingResponse(status: string): boolean {
  return ["H", "P"].includes(status);
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

function createFallbackReviewId(): string {
  return "review-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}
