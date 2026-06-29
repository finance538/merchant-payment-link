import type { Config } from "@netlify/functions";
import {
  listPaymentReviews,
  setManualDecision,
  touchPanelHeartbeat,
  type ManualDecisionStatus,
  type PaymentReview,
} from "./_shared/payment-review";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

type DecisionPayload = {
  action?: string;
  id?: string;
  status?: ManualDecisionStatus;
  reason?: string;
  category?: string;
};

type TelegramResponse = {
  ok?: boolean;
  description?: string;
  error_code?: number;
  result?: {
    message_id?: number;
  };
};

const allowedStatuses = new Set<ManualDecisionStatus>(["success", "failed", "pending", "error"]);

export default async (req: Request) => {
  const authError = authorise(req);

  if (authError) return authError;

  if (req.method === "GET") {
    await touchPanelHeartbeat();

    return json({ reviews: await listPaymentReviews() }, 200);
  }

  if (req.method === "POST") {
    const payload = (await req.json().catch(() => ({}))) as DecisionPayload;

    if (payload.action === "test-telegram") {
      return sendTelegramTest(req);
    }

    if (payload.action === "register-tamara-webhook") {
      return registerTamaraWebhook(req);
    }

    if (!payload.id || !payload.status || !allowedStatuses.has(payload.status)) {
      return json({ error: "Invalid decision" }, 400);
    }

    const reviews = await listPaymentReviews(100);
    const currentReview = reviews.find((review) => review.id === payload.id);

    if (!currentReview) {
      return json({ error: "Payment review was not found" }, 404);
    }

    if (payload.status === "success" && !isGatewayAccepted(currentReview)) {
      return json({ error: "Success can only be selected after the gateway confirms an accepted payment" }, 409);
    }

    const review = await setManualDecision(payload.id, payload.status, payload.reason, payload.category);

    return json({ review }, 200);
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config: Config = {
  path: "/api/payment-control",
  method: ["GET", "POST"],
};

function authorise(req: Request): Response | null {
  const configuredToken = Netlify.env.get("CONTROL_PANEL_TOKEN");

  if (!configuredToken) {
    return json({ error: "CONTROL_PANEL_TOKEN is missing" }, 500);
  }

  const requestUrl = new URL(req.url);
  const headerToken = req.headers.get("x-control-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = requestUrl.searchParams.get("token") || headerToken;

  if (token !== configuredToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  return null;
}

function isGatewayAccepted(review: PaymentReview): boolean {
  const status = normaliseStatus(review.actualStatus);

  return review.actualAccepted || ["A", "CAPTURED", "ORDER_APPROVED", "ORDER_AUTHORISED", "ORDER_CAPTURED"].includes(status);
}

function normaliseStatus(status: string | undefined): string {
  return String(status || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

async function registerTamaraWebhook(req: Request): Promise<Response> {
  const apiToken = Netlify.env.get("TAMARA_API_TOKEN") || Netlify.env.get("TAMARA_MERCHANT_KEY");
  const apiBaseUrl = (Netlify.env.get("TAMARA_API_URL") || "https://api.tamara.co").replace(/\/$/, "");

  if (!apiToken) {
    return json({ ok: false, error: "TAMARA_API_TOKEN is missing in Netlify" }, 500);
  }

  const webhookUrl = new URL("/api/tamara-webhook", getPublicOrigin(req)).toString();
  const response = await fetch(apiBaseUrl + "/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiToken,
    },
    body: JSON.stringify({
      type: "order",
      events: [
        "order_approved",
        "order_declined",
        "order_authorised",
        "order_canceled",
        "order_captured",
        "order_refunded",
        "order_expired",
      ],
      url: webhookUrl,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string; webhook_id?: string };

  if (!response.ok) {
    return json(
      {
        ok: false,
        error: data.message || data.error || `Tamara webhook registration failed with HTTP ${response.status}`,
      },
      502,
    );
  }

  return json({ ok: true, webhookUrl, webhookId: data.webhook_id || null }, 200);
}

async function sendTelegramTest(req: Request): Promise<Response> {
  const botToken = Netlify.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Netlify.env.get("TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) {
    return json({ ok: false, error: "Telegram bot token or chat id is missing in Netlify" }, 500);
  }

  const controlUrl = new URL("/control.html", getPublicOrigin(req));
  controlUrl.searchParams.set("token", Netlify.env.get("CONTROL_PANEL_TOKEN") || "");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: ["Telegram test", "Merchant payment alerts are connected.", controlUrl.toString()].join("\n"),
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Open control panel", url: controlUrl.toString() }]],
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as TelegramResponse;

  if (!response.ok || data.ok === false) {
    return json(
      {
        ok: false,
        error: data.description || `Telegram request failed with HTTP ${response.status}`,
        errorCode: data.error_code || response.status,
      },
      502,
    );
  }

  return json({ ok: true, message: "Telegram test sent", messageId: data.result?.message_id || null }, 200);
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
