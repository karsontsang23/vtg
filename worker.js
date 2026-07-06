// 💡 核心處理器：不論咩模式，都行呢度
function coreHandler() {
  return new Response("【終極測試成功】你睇到呢行字，代表 Worker 底層管道終於通咗！", {
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

// ── 模式一：新式 ES Module ──
export default {
  async fetch(req, env) {
    return coreHandler();
  }
};

// ── 模式二：舊式 Service Worker (防止 Cloudflare 誤判) ──
if (typeof addEventListener === 'function') {
  addEventListener('fetch', event => {
    event.respondWith(coreHandler());
  });
}
