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
  id?: string;
  status?: ManualDecisionStatus;
  reason?: string;
  category?: string;
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

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
