import type { Config } from "@netlify/functions";

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
  const isAccepted = responseStatus === "A";
  const targetPath = isAccepted ? "/success.html" : "/cancel.html";
  const redirectUrl = new URL(targetPath, origin);

  if (amount) redirectUrl.searchParams.set("amount", amount);
  redirectUrl.searchParams.set("currency", normaliseCurrency(currency));
  if (transactionReference) redirectUrl.searchParams.set("tran_ref", transactionReference);
  if (responseStatus) redirectUrl.searchParams.set("status", responseStatus);
  if (responseCode) redirectUrl.searchParams.set("code", responseCode);
  if (responseMessage) redirectUrl.searchParams.set("message", responseMessage);

  console.info(
    "PayTabs return",
    JSON.stringify({
      tranRef: transactionReference || null,
      status: responseStatus || null,
      code: responseCode || null,
      accepted: isAccepted,
    }),
  );

  return Response.redirect(redirectUrl.toString(), 302);
};

export const config: Config = {
  path: "/api/paytabs-return",
  method: ["GET", "POST"],
};

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

function getPublicOrigin(req: Request): string {
  const configuredUrl = Netlify.env.get("PUBLIC_SITE_URL") || Netlify.env.get("URL");

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return new URL(req.url).origin;
}
