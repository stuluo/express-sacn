const NOCOBASE_API_URL = "https://erp.qihonghr.cn/api";
const NOCOBASE_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoiYWRtaW4iLCJpYXQiOjE3NzYyNDU1MTcsImV4cCI6MzMzMzM4NDU1MTd9.7OhUv_mw8JUKSBPFo0neEr-kUDO_N-82UxTs6Bx_RSQ";

export async function onRequest({ request, params }: { request: Request; params: { path?: string[] } }) {
  const subPath = (params.path || []).join("/");
  const url = new URL(request.url);
  const targetUrl = `${NOCOBASE_API_URL}/${subPath}${url.search}`;

  const headers = new Headers({
    Authorization: `Bearer ${NOCOBASE_TOKEN}`,
    Accept: "application/json",
  });

  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  } else if (request.method !== "GET" && request.method !== "DELETE") {
    headers.set("Content-Type", "application/json");
  }

  const init: RequestInit = { method: request.method, headers };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    if (body) init.body = body;
  }

  try {
    const response = await fetch(targetUrl, init);
    const resHeaders = new Headers(response.headers);
    resHeaders.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err: any) {
    return Response.json({ error: "Proxy error", message: err.message }, { status: 500 });
  }
}
