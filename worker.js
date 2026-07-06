// 簡單的 JSON 回傳工具
function sendJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);

      // ① iPhone 上傳影片
      if (req.method === "POST" && url.pathname === "/") {
        const jobId = crypto.randomUUID();
        const videoBuffer = await req.arrayBuffer();
        
        if (videoBuffer.byteLength === 0) return sendJson({ error: "影片檔案為空" }, 400);
        if (!env.GIF_DB) return sendJson({ error: "未綁定 KV" }, 500);

        await env.GIF_DB.put(`video_${jobId}`, videoBuffer, { expirationTtl: 3600 });
        await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing" }), { expirationTtl: 3600 });

        // 觸發 GitHub（記得改 YOUR_USER）
        const ghRes = await fetch("https://api.github.com/repos/YOUR_USER/gif-ffmpeg-worker/actions/workflows/main.yml/dispatches", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "Accept": "application/vnd.github+json",
            "User-Agent": "CF-Worker"
          },
          body: JSON.stringify({
            ref: "main",
            inputs: { video_url: "KV_STORED", job_id: jobId }
          })
        });

        if (!ghRes.ok) return sendJson({ error: "GitHub 拒絕連線" }, 500);
        return sendJson({ job_id: jobId });
      }

      // 供 GitHub 下載影片
      if (url.pathname === "/get-video") {
        const jobId = url.searchParams.get("id");
        const videoData = await env.GIF_DB.get(`video_${jobId}`, { type: "arrayBuffer" });
        if (!videoData) return sendJson({ error: "找不到影片" }, 404);
        return new Response(videoData, { headers: { "Content-Type": "video/mp4" } });
      }

      // ② GitHub 直接回傳「純 GIF 檔案」（不再用 ZIP，免解壓）
      if (req.method === "POST" && url.pathname === "/callback") {
        const jobId = url.searchParams.get("id");
        const gifBuffer = await req.arrayBuffer();
        
        // 直接把 GIF 二進位檔案存入 KV
        await env.GIF_DB.put(`gif_${jobId}`, gifBuffer, { expirationTtl: 3600 });
        await env.GIF_DB.put(jobId, JSON.stringify({ status: "done" }), { expirationTtl: 3600 });
        return sendJson({ ok: true });
      }

      // ③ iPhone 檢查並下載 GIF
      if (url.pathname.startsWith("/result")) {
        const jobId = url.searchParams.get("id");
        const data = await env.GIF_DB.get(jobId);
        if (!data) return sendJson({ status: "not_found" }, 404);
        
        const job = JSON.parse(data);
        if (job.status !== "done") return sendJson({ status: job.status });

        // 直接從 KV 讀取純 GIF 回傳
        const gifData = await env.GIF_DB.get(`gif_${jobId}`, { type: "arrayBuffer" });
        await env.GIF_DB.delete(`video_${jobId}`);
        
        return new Response(gifData, {
          headers: { "Content-Type": "image/gif" }
        });
      }

      // 瀏覽器打開時顯示
      return sendJson({ status: "online", message: "Worker 運作正常！" });

    } catch (err) {
      return sendJson({ error: "系統崩潰", details: err.message }, 500);
    }
  }
};
