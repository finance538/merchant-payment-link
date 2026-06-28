import type { Config } from "@netlify/functions";
import {
  listPaymentReviews,
  setManualDecision,
  touchPanelHeartbeat,
  type ManualDecisionStatus,
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

    if (!payload.id || !payload.status || !allowedStatuses.has(payload.status)) {
      return json({ error: "Invalid decision" }, 400);
    }

    const reviews = await listPaymentReviews(100);
    const currentReview = reviews.find((review) => review.id === payload.id);

    if (!currentReview) {
      return json({ error: "Payment review was not found" }, 404);
    }

    if (payload.status === "success" && !currentReview.actualAccepted) {
      return json({ error: "Success can only be selected after PayTabs confirms an accepted payment" }, 409);
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

async function sendTelegramTest(req: Request): Promise<Response> {
  const botToken = Netlify.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Netlify.env.get("TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) {
    return json({ ok: false, error: "Telegram bot token or chat id is missing in Netlify" }, 500);
  }

  const controlUrl = new URL("/control.html", getPublicOrigin(req));
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
