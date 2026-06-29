import { getStore } from "@netlify/blobs";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

export type ManualDecisionStatus = "success" | "failed" | "pending" | "error";

export type ManualDecision = {
  status: ManualDecisionStatus;
  reason?: string;
  category?: string;
  decidedAt: string;
};

export type PaymentReview = {
  id: string;
  cartId?: string;
  tranRef?: string;
  provider?: string;
  gateway?: string;
  gatewayOrderId?: string;
  checkoutId?: string;
  customerIp?: string;
  customerId?: string;
  customerCountry?: string;
  cardType?: string;
  cardScheme?: string;
  cardCountry?: string;
  amount?: string;
  currency: string;
  actualStatus?: string;
  actualCode?: string;
  actualMessage?: string;
  actualAccepted: boolean;
  source: "created" | "paytabs-return" | "paytabs-callback" | "tamara-return" | "tamara-webhook" | "tap-return" | "tap-webhook";
  decision?: ManualDecision;
  notifiedAt?: string;
  notifications?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

type PaymentReviewPatch = Omit<Partial<PaymentReview>, "id"> & { id: string };

const store = getStore("merchant-payment-reviews", { consistency: "strong" });
const paymentsPrefix = "payments/";
const panelHeartbeatKey = "panel/heartbeat";
const manualDecisionWaitMs = 20000;

export async function upsertPaymentReview(patch: PaymentReviewPatch): Promise<PaymentReview> {
  const now = new Date().toISOString();
  const existing = await getPaymentReview(patch.id);
  const base = existing || createEmptyPaymentReview(patch.id, now);
  let review = mergePaymentReview(base, patch, now);
  const latest = await getPaymentReview(patch.id);

  if (latest && latest.updatedAt !== existing?.updatedAt) {
    review = mergePaymentReview(latest, patch, now);
  }

  await savePaymentReview(review);

  return review;
}

function createEmptyPaymentReview(id: string, now: string): PaymentReview {
  return {
    id,
    currency: "SAR",
    actualAccepted: false,
    source: "created",
    createdAt: now,
    updatedAt: now,
  };
}

function mergePaymentReview(base: PaymentReview, patch: PaymentReviewPatch, now: string): PaymentReview {
  const preserveGatewayState = patch.source === "created" && base.source !== "created";

  return {
    ...base,
    ...patch,
    id: patch.id,
    cartId: patch.cartId || base.cartId,
    tranRef: patch.tranRef || base.tranRef,
    provider: patch.provider || base.provider,
    gateway: patch.gateway || base.gateway,
    gatewayOrderId: patch.gatewayOrderId || base.gatewayOrderId,
    checkoutId: patch.checkoutId || base.checkoutId,
    customerIp: patch.customerIp || base.customerIp,
    customerId: patch.customerId || base.customerId,
    customerCountry: patch.customerCountry || base.customerCountry,
    cardType: patch.cardType || base.cardType,
    cardScheme: patch.cardScheme || base.cardScheme,
    cardCountry: patch.cardCountry || base.cardCountry,
    amount: patch.amount || base.amount,
    currency: patch.currency || base.currency || "SAR",
    actualStatus: preserveGatewayState ? base.actualStatus || patch.actualStatus : patch.actualStatus || base.actualStatus,
    actualCode: preserveGatewayState ? base.actualCode || patch.actualCode : patch.actualCode || base.actualCode,
    actualMessage: preserveGatewayState ? base.actualMessage || patch.actualMessage : patch.actualMessage || base.actualMessage,
    actualAccepted: preserveGatewayState
      ? base.actualAccepted || patch.actualAccepted || false
      : patch.actualAccepted ?? base.actualAccepted ?? false,
    source: preserveGatewayState ? base.source : patch.source || base.source || "created",
    decision: patch.decision || base.decision,
    notifiedAt: patch.notifiedAt || base.notifiedAt,
    notifications: {
      ...(base.notifications || {}),
      ...(patch.notifications || {}),
    },
    createdAt: base.createdAt,
    updatedAt: now,
  };
}

export async function savePaymentReview(review: PaymentReview): Promise<void> {
  await store.setJSON(paymentKey(review.id), review);
}

export async function getPaymentReview(id: string): Promise<PaymentReview | null> {
  return (await store.get(paymentKey(id), { type: "json" })) as PaymentReview | null;
}

export async function listPaymentReviews(limit = 30): Promise<PaymentReview[]> {
  const blobs = [];

  for await (const result of store.list({ prefix: paymentsPrefix, paginate: true })) {
    blobs.push(...result.blobs);
  }

  const reviews = await Promise.all(
    blobs.map(async (blob) => (await store.get(blob.key, { type: "json" })) as PaymentReview | null),
  );

  return reviews
    .filter((review): review is PaymentReview => Boolean(review))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export async function setManualDecision(
  id: string,
  status: ManualDecisionStatus,
  reason?: string,
  category?: string,
): Promise<PaymentReview | null> {
  const review = await getPaymentReview(id);

  if (!review) return null;

  const updatedReview: PaymentReview = {
    ...review,
    decision: {
      status,
      reason,
      category,
      decidedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  await savePaymentReview(updatedReview);

  return updatedReview;
}

export async function waitForManualDecision(id: string, waitMs = manualDecisionWaitMs): Promise<ManualDecision | null> {
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    const review = await getPaymentReview(id);

    if (review?.decision) return review.decision;

    await sleep(1000);
  }

  return null;
}

export async function touchPanelHeartbeat(): Promise<void> {
  await store.setJSON(panelHeartbeatKey, { lastSeenAt: new Date().toISOString() });
}

export async function isPanelActive(thresholdMs = 25000): Promise<boolean> {
  const heartbeat = (await store.get(panelHeartbeatKey, { type: "json" })) as { lastSeenAt?: string } | null;

  if (!heartbeat?.lastSeenAt) return false;

  return Date.now() - Date.parse(heartbeat.lastSeenAt) <= thresholdMs;
}

export async function notifyMerchantIfAway(review: PaymentReview, origin: string): Promise<PaymentReview> {
  const currentReview = (await getPaymentReview(review.id)) || review;

  if (currentReview.notifiedAt) return currentReview;

  const panelActive = await isPanelActive();
  const text = buildTelegramText(currentReview, origin, "Payment needs review", [
    `Panel: ${panelActive ? "open" : "away"}`,
  ]);

  if (!(await sendTelegramMessage(text, origin, currentReview.id))) return currentReview;

  const latestReview = (await getPaymentReview(currentReview.id)) || currentReview;
  const updatedReview: PaymentReview = {
    ...latestReview,
    notifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await savePaymentReview(updatedReview);

  return updatedReview;
}

export async function notifyMerchantEvent(
  review: PaymentReview,
  origin: string,
  eventKey: string,
  title: string,
  details: string[] = [],
): Promise<PaymentReview> {
  const currentReview = (await getPaymentReview(review.id)) || review;

  if (currentReview.notifications?.[eventKey]) return currentReview;

  const text = buildTelegramText(currentReview, origin, title, details);

  if (!(await sendTelegramMessage(text, origin, currentReview.id))) return currentReview;

  const now = new Date().toISOString();
  const latestReview = (await getPaymentReview(currentReview.id)) || currentReview;
  const updatedReview: PaymentReview = {
    ...latestReview,
    notifications: {
      ...(latestReview.notifications || {}),
      [eventKey]: now,
    },
    updatedAt: now,
  };

  await savePaymentReview(updatedReview);

  return updatedReview;
}

function buildTelegramText(review: PaymentReview, origin: string, title: string, details: string[]): string {
  const controlUrl = buildControlUrl(origin, review.id);

  return [
    title,
    `Gateway: ${review.gateway || review.provider || "-"}`,
    `Amount: ${review.amount || "-"} ${review.currency}`,
    `Customer ID: ${review.customerId || review.id}`,
    `Customer IP: ${review.customerIp || "-"}`,
    `Country: ${review.customerCountry || review.cardCountry || "-"}`,
    `Card: ${review.cardType || review.cardScheme || "-"}`,
    `Gateway status: ${review.actualStatus || "-"}${review.actualMessage ? ` - ${review.actualMessage}` : ""}`,
    `Transaction: ${review.tranRef || review.gatewayOrderId || "-"}`,
    ...details,
    `Control panel: ${controlUrl.toString()}`,
  ].join("\n");
}

async function sendTelegramMessage(text: string, origin: string, reviewId: string): Promise<boolean> {
  const botToken = Netlify.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Netlify.env.get("TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) {
    console.warn("Telegram notification skipped: missing bot token or chat id");
    return false;
  }

  const controlUrl = buildControlUrl(origin, reviewId);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Open control panel", url: controlUrl.toString() }]],
      },
    }),
  });

  if (!response.ok) {
    const failure = await response.text().catch(() => "");
    console.warn("Telegram notification failed", response.status, failure);
    return false;
  }

  return true;
}

function buildControlUrl(origin: string, reviewId: string): URL {
  const controlUrl = new URL("/control.html", origin);
  const panelToken = Netlify.env.get("CONTROL_PANEL_TOKEN");

  controlUrl.searchParams.set("cart_id", reviewId);
  if (panelToken) controlUrl.searchParams.set("token", panelToken);

  return controlUrl;
}

function paymentKey(id: string): string {
  return paymentsPrefix + encodeURIComponent(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
