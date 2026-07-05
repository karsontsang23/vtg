export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 建立 Job
    if (req.method === "POST") {
      const { video_url } = await req.json();
      const jobId = crypto.randomUUID();
      
      // 💡 使用 env.GIF_DB 寫入初始狀態 (設定 1 小時後自動過期釋放空間)
      await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing", gif: null }), { expirationTtl: 3600 });

      // ... 觸發 GitHub Actions 的程式碼 ...
      return Response.json({ job_id: jobId });
    }

    // ② GitHub Webhook Callback
    if (url.pathname === "/callback") {
      const { job_id, gif_url } = await req.json();
      
      // 💡 使用 env.GIF_DB 更新狀態為完成
      await env.GIF_DB.put(job_id, JSON.stringify({ status: "done", gif: gif_url }), { expirationTtl: 3600 });
      return Response.json({ ok: true });
    }

    // ③ iPhone 檢查結果
    if (url.pathname.startsWith("/result")) {
      const jobId = url.searchParams.get("id");
      
      // 💡 使用 env.GIF_DB 讀取狀態
      const data = await env.GIF_DB.get(jobId);
      if (!data) return Response.json({ status: "not_found", gif: null }, { status: 404 });
      
      return new Response(data, { headers: { "Content-Type": "application/json" } });
    }
  }
};
