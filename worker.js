import { unzipSync } from 'fflate';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 發出 POST：上傳影片並啟動任務
    if (req.method === "POST" && url.pathname === "/") {
      try {
        const jobId = crypto.randomUUID();
        
        // 讀取影片二進位數據
        const videoBuffer = await req.arrayBuffer();
        if (videoBuffer.byteLength === 0) {
          return Response.json({ error: "上傳失敗：影片檔案為空，請檢查捷徑輸入" }, { status: 400 });
        }

        // 檢查 KV 綁定狀態
        if (!env.GIF_DB) {
          return Response.json({ error: "設定錯誤：未在 Cloudflare 綁定名為 GIF_DB 的 KV 空間" }, { status: 500 });
        }

        // 暫存影片到 KV
        await env.GIF_DB.put(`video_${jobId}`, videoBuffer, { expirationTtl: 3600 });
        
        // 寫入任務狀態
        await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing", gif: null }), { expirationTtl: 3600 });

        // 檢查 Token 狀態
        if (!env.GITHUB_TOKEN) {
          return Response.json({ error: "設定錯誤：未在 Worker 設定 GITHUB_TOKEN 環境變數" }, { status: 500 });
        }

        // 觸發 GitHub Actions（請記得將 YOUR_USER 改為你的 GitHub 帳號）
        const ghRes = await fetch("https://api.github.com/repos/YOUR_USER/gif-ffmpeg-worker/actions/workflows/main.yml/dispatches", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "Accept": "application/vnd.github+json",
            "User-Agent": "Cloudflare-Worker"
          },
          body: JSON.stringify({
            ref: "main",
            inputs: { video_url: "KV_STORED", job_id: jobId }
          })
        });

        if (!ghRes.ok) {
          const errText = await ghRes.text();
          return Response.json({ error: "GitHub API 拒絕連線", details: errText }, { status: 500 });
        }

        // 成功則回傳正確的 JSON 辭典
        return Response.json({ job_id: jobId });

      } catch (err) {
        // 捕捉任何未知的程式碼錯誤並以 JSON 回傳
        return Response.json({ error: "Worker 執行出錯", details: err.message }, { status: 500 });
      }
    }

    // 供 GitHub Actions 下載影片
    if (url.pathname === "/get-video") {
      const jobId = url.searchParams.get("id");
      const videoData = await env.GIF_DB.get(`video_${jobId}`, { type: "arrayBuffer" });
      
      if (!videoData) return new Response("Video not found", { status: 404 });
      
      return new Response(videoData, {
        headers: { "Content-Type": "video/mp4" }
      });
    }

    // ② GitHub Webhook 回傳結果
    if (url.pathname === "/callback") {
      const { job_id, gif_url } = await req.json();
      await env.GIF_DB.put(job_id, JSON.stringify({ status: "done", gif: gif_url }), { expirationTtl: 3600 });
      return Response.json({ ok: true });
    }

    // ③ iPhone 檢查結果並下載 GIF
    if (url.pathname.startsWith("/result")) {
      const jobId = url.searchParams.get("id");
      if (!jobId) return Response.json({ error: "缺少 id 參數" }, { status: 400 });

      const data = await env.GIF_DB.get(jobId);
      if (!data) return Response.json({ status: "not_found" }, { status: 404 });
      
      const job = JSON.parse(data);
      if (job.status !== "done") {
        return Response.json({ status: job.status });
      }

      try {
        const zipRes = await fetch(job.gif);
        const zipBuffer = await zipRes.arrayBuffer();
        const unzipped = unzipSync(new Uint8Array(zipBuffer));
        const gifFileName = Object.keys(unzipped).find(name => name.endsWith('.gif'));
        
        if (!gifFileName) return new Response("GIF not found in ZIP", { status: 404 });
        
        await env.GIF_DB.delete(`video_${jobId}`);

        return new Response(unzipped[gifFileName], {
          headers: {
            "Content-Type": "image/gif",
            "Content-Disposition": `inline; filename="${jobId}.gif"`
          }
        });
      } catch (err) {
        return new Response("Unzip failed: " + err.message, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
