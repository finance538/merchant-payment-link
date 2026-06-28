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

type TapPayload = Record<string, unknown>;

export default async (req: Request) => {
  const requestUrl = new URL(req.url);
  const origin = getPublicOrigin(req);
  const incomingData = await readRequestData(req);
  const incomingTapId = pickString(incomingData, ["tap_id", "tapId", "charge_id", "chargeId", "id"]);
  const queriedData = incomingTapId ? await queryTapCharge(incomingTapId) : null;
  const resultData = queriedData || incomingData;
  const tapId = pickString(resultData, ["tap_id", "tapId", "charge_id", "chargeId", "id"]) || incomingTapId;
  const cartId = pickString(resultData, ["metadata.cart_id", "metadata.cartId", "reference.transaction", "reference.order", "cart_id", "cartId"]) || requestUrl.searchParams.get("cart_id") || "";
  const amount = pickString(resultData, ["amount"]) || requestUrl.searchParams.get("amount") || "";
  const currency = normaliseCurrency(pickString(resultData, ["currency"]) || requestUrl.searchParams.get("currency") || "SAR");
  const status = pickString(resultData, ["status"]).toUpperCase();
  const responseCode = pickString(resultData, ["response.code", "gateway.response.code", "acquirer.response.code"]);
  const responseMessage = pickString(resultData, ["response.message", "gateway.response.message", "acquirer.response.message"]);
  const reviewId = cartId || tapId || createFallbackReviewId();
  const actualAccepted = status === "CAPTURED";
  const actualPending = isPendingTapStatus(status);
  const autoRejected = isRejectedTapStatus(status);
  const metadata = extractReviewMetadata(resultData, cartId || tapId || reviewId);

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
    actualAccepted,
    source: "tap-return",
  });

  await notifyMerchantIfAway(review, origin);

  const decision = autoRejected ? null : await waitForManualDecision(reviewId, 20000);
  const redirectUrl = buildRedirectUrl(origin, {
    id: reviewId,
    amount,
    currency,
    transactionReference: tapId,
    responseStatus: status,
    responseCode,
    responseMessage,
    actualAccepted,
    actualPending,
    decision,
  });

  console.info(
    "Tap return",
    JSON.stringify({
      reviewId,
      tapId: tapId || null,
      status: status || null,
      code: responseCode || null,
      accepted: actualAccepted,
      autoRejected,
      decision: decision?.status || "auto",
    }),
  );

  return Response.redirect(redirectUrl.toString(), 302);
};

export const config: Config = {
  path: "/api/tap-return",
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
  if (data.transactionReference) redirectUrl.searchParams.set("tap_id", data.transactionReference);
  if (data.responseStatus) redirectUrl.searchParams.set("status", data.responseStatus);
  if (data.responseCode) redirectUrl.searchParams.set("code", data.responseCode);
  if (message) redirectUrl.searchParams.set("message", message);
  if (data.decision) redirectUrl.searchParams.set("manual", data.decision.status);

  return redirectUrl;
}

async function queryTapCharge(chargeId: string): Promise<TapPayload | null> {
  const secretKey = Netlify.env.get("TAP_SECRET_KEY");
  const apiUrl = (Netlify.env.get("TAP_API_URL") || "https://api.tap.company/v2/charges").replace(/\/$/, "");

  if (!secretKey || !chargeId) return null;

  const response = await fetch(apiUrl + "/" + encodeURIComponent(chargeId), {
    method: "GET",
    headers: {
      Authorization: "Bearer " + secretKey,
    },
  });

  const data = (await response.json().catch(() => ({}))) as TapPayload;

  return response.ok ? data : null;
}

async function readRequestData(req: Request): Promise<TapPayload> {
  const data: TapPayload = {};
  const url = new URL(req.url);

  url.searchParams.forEach((value, key) => {
    data[key] = value;
  });

  if (req.method === "GET") return data;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const jsonData = (await req.json().catch(() => ({}))) as TapPayload;

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

function isRejectedTapStatus(status: string): boolean {
  if (!status) return false;

  return !["CAPTURED", "INITIATED", "IN_PROGRESS", "IN PROGRESS"].includes(status);
}

function isPendingTapStatus(status: string): boolean {
  return ["INITIATED", "IN_PROGRESS", "IN PROGRESS"].includes(status);
}

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

function createFallbackReviewId(): string {
  return "tap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}
