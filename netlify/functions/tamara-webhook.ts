import type { Config } from "@netlify/functions";
import { notifyMerchantEvent, upsertPaymentReview } from "./_shared/payment-review";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

type TamaraWebhookPayload = {
  order_id?: string;
  order_reference_id?: string;
  order_number?: string;
  event_type?: string;
  data?: {
    declined_reason?: string;
    declined_code?: string;
    decline_type?: string;
    [key: string]: unknown;
  };
};

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!(await isAuthorisedTamaraWebhook(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const origin = getPublicOrigin(req);
  const payload = (await req.json().catch(() => ({}))) as TamaraWebhookPayload;
  const reviewId = payload.order_reference_id || payload.order_number || payload.order_id || "";

  if (!reviewId) {
    return json({ error: "Missing Tamara order reference" }, 400);
  }

  const eventType = payload.event_type || "tamara_update";
  const actualAccepted = ["order_approved", "order_authorised", "order_captured"].includes(eventType);
  const actualMessage = payload.data?.declined_reason || payload.data?.decline_type || eventType;
  const review = await upsertPaymentReview({
    id: reviewId,
    cartId: payload.order_reference_id || reviewId,
    provider: "tamara",
    gateway: "Tamara",
    gatewayOrderId: payload.order_id,
    customerId: payload.order_reference_id || reviewId,
    actualStatus: eventType,
    actualCode: payload.data?.declined_code,
    actualMessage,
    actualAccepted,
    source: "tamara-webhook",
  });

  await notifyMerchantEvent(review, origin, "tamara-" + eventType, "Tamara payment update", [
    `Event: ${eventType}`,
    `Order ID: ${payload.order_id || "-"}`,
  ]);

  return json({ ok: true }, 200);
};

export const config: Config = {
  path: "/api/tamara-webhook",
  method: ["POST"],
};

async function isAuthorisedTamaraWebhook(req: Request): Promise<boolean> {
  const notificationToken = Netlify.env.get("TAMARA_NOTIFICATION_TOKEN");

  if (!notificationToken) return true;

  const requestUrl = new URL(req.url);
  const headerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const queryToken = requestUrl.searchParams.get("tamaraToken") || "";
  const token = queryToken || headerToken;

  if (!token) return false;
  if (token === notificationToken) return true;

  return verifyHs256Jwt(token, notificationToken);
}

async function verifyHs256Jwt(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");

  if (parts.length !== 3) return false;

  const data = toArrayBuffer(new TextEncoder().encode(parts[0] + "." + parts[1]));
  const signature = base64UrlToBytes(parts[2]);
  const signatureBuffer = toArrayBuffer(signature);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify("HMAC", key, signatureBuffer, data).catch(() => false);
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function getPublicOrigin(req: Request): string {
  const configuredUrl = Netlify.env.get("PUBLIC_SITE_URL") || Netlify.env.get("URL");

  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

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
