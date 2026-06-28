import type { Config } from "@netlify/functions";

type PayTabsPayload = Record<string, unknown>;

export default async (req: Request) => {
  const data = await readRequestData(req);
  const transactionReference = pickString(data, ["tran_ref", "tranRef", "transaction_ref", "transactionReference"]);
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

  console.info(
    "PayTabs callback",
    JSON.stringify({
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
