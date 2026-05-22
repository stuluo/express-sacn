export async function onRequest() {
  return Response.json({
    status: "ok",
    serverTime: new Date().toISOString(),
    proxyTarget: "https://erp.qihonghr.cn/api"
  });
}
