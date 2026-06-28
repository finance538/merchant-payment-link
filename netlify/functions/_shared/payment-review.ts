import { getStore } from "@netlify/blobs";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

export type ManualDecisionStatus = "success" | "failed" | "pending";

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
  amount?: string;
  currency: string;
  actualStatus?: string;
  actualCode?: string;
  actualMessage?: string;
  actualAccepted: boolean;
  source: "created" | "paytabs-return" | "paytabs-callback";
  decision?: ManualDecision;
  notifiedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type PaymentReviewPatch = Omit<Partial<PaymentReview>, "id"> & { id: string };

const store = getStore("merchant-payment-reviews", { consistency: "strong" });
const paymentsPrefix = "payments/";
const panelHeartbeatKey = "panel/heartbeat";

export async function upsertPaymentReview(patch: PaymentReviewPatch): Promise<PaymentReview> {
  const now = new Date().toISOString();
  const existing = await getPaymentReview(patch.id);
  const base: PaymentReview = existing || {
    id: patch.id,
    currency: "SAR",
    actualAccepted: false,
    source: "created",
    createdAt: now,
    updatedAt: now,
  };
  const review: PaymentReview = {
    ...base,
    ...patch,
    id: patch.id,
    currency: patch.currency || base.currency || "SAR",
    actualAccepted: patch.actualAccepted ?? base.actualAccepted ?? false,
    source: patch.source || base.source || "created",
    createdAt: base.createdAt,
    updatedAt: now,
  };

  await savePaymentReview(review);

  return review;
}

export async function savePaymentReview(review: PaymentReview): Promise<void> {
  await store.setJSON(paymentKey(review.id), review);
}

export async function getPaymentReview(id: string): Promise<PaymentReview | null> {
  return (await store.get(paymentKey(id), { type: "json" })) as PaymentReview | null;
}

export async function listPaymentReviews(limit = 30): Promise<PaymentReview[]> {
  const result = await store.list({ prefix: paymentsPrefix });
  const reviews = await Promise.all(
    result.blobs.map(async (blob) => (await store.get(blob.key, { type: "json" })) as PaymentReview | null),
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

export async function waitForManualDecision(id: string, waitMs = 10000): Promise<ManualDecision | null> {
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
  if (await isPanelActive()) return review;
  if (review.notifiedAt) return review;

  const botToken = Netlify.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Netlify.env.get("TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) return review;

  const controlUrl = new URL("/control.html", origin);
  controlUrl.searchParams.set("cart_id", review.id);

  const text = [
    "عملية دفع تحتاج مراجعة",
    `المبلغ: ${review.amount || "-"} ${review.currency}`,
    `حالة PayTabs: ${review.actualStatus || "-"}${review.actualMessage ? ` - ${review.actualMessage}` : ""}`,
    `رقم العملية: ${review.tranRef || "-"}`,
    `لوحة التاجر: ${controlUrl.toString()}`,
  ].join("\n");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) return review;

  const updatedReview: PaymentReview = {
    ...review,
    notifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await savePaymentReview(updatedReview);

  return updatedReview;
}

function paymentKey(id: string): string {
  return paymentsPrefix + encodeURIComponent(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
