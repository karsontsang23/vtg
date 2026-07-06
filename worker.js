import { unzipSync } from 'fflate';

// 💡 建立一個最安全、不依賴新語法的 JSON 回傳工具
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

      // ① iPhone 發出 POST：上傳影片並啟動任務
      if (req.method === "POST" && url.pathname === "/") {
        const jobId = crypto.randomUUID();
        
        const videoBuffer = await req.arrayBuffer();
        if (videoBuffer.byteLength === 0) {
          return sendJson({ error: "上傳失敗：影片檔案為空，請檢查捷徑輸入" }, 400);
        }

        if (!env.GIF_DB) {
          return sendJson({ error: "設定錯誤：未在 Cloudflare 綁定名為 GIF_DB 的 KV 空間" }, 500);
        }

        await env.GIF_DB.put(`video_${jobId}`, videoBuffer, { expirationTtl: 3600 });
        await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing", gif: null }), { expirationTtl: 3600 });

        if (!env.GITHUB_TOKEN) {
          return sendJson({ error: "設定錯誤：未在 Worker 設定 GITHUB_TOKEN 環境變數" }, 500);
        }

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
          return sendJson({ error: "GitHub API 拒絕連線", details: errText }, 500);
        }

        return sendJson({ job_id: jobId });
      }

      // 供 GitHub Actions 下載影片
      if (url.pathname === "/get-video") {
        const jobId = url.searchParams.get("id");
        const videoData = await env.GIF_DB.get(`video_${jobId}`, { type: "arrayBuffer" });
        
        if (!videoData) return sendJson({ error: "Video not found" }, 404);
        
        return new Response(videoData, {
          headers: { "Content-Type": "video/mp4" }
        });
      }

      // ② GitHub Webhook 回傳結果
      if (url.pathname === "/callback") {
        const { job_id, gif_url } = await req.json();
        await env.GIF_DB.put(job_id, JSON.stringify({ status: "done", gif: gif_url }), { expirationTtl: 3600 });
        return sendJson({ ok: true });
      }

      // ③ iPhone 檢查結果並下載 GIF
      if (url.pathname.startsWith("/result")) {
        const jobId = url.searchParams.get("id");
        if (!jobId) return sendJson({ error: "缺少 id 參數" }, 400);

        const data = await env.GIF_DB.get(jobId);
        if (!data) return sendJson({ status: "not_found" }, 404);
        
        const job = JSON.parse(data);
        if (job.status !== "done") {
          return sendJson({ status: job.status });
        }

        try {
          const zipRes = await fetch(job.gif);
          const zipBuffer = await zipRes.arrayBuffer();
          const unzipped = unzipSync(new Uint8Array(zipBuffer));
          const gifFileName = Object.keys(unzipped).find(name => name.endsWith('.gif'));
          
          if (!gifFileName) return sendJson({ error: "ZIP 檔內找不到 GIF" }, 404);
          
          await env.GIF_DB.delete(`video_${jobId}`);

          return new Response(unzipped[gifFileName], {
            headers: {
              "Content-Type": "image/gif",
              "Content-Disposition": `inline; filename="${jobId}.gif"`
            }
          });
        } catch (err) {
          return sendJson({ error: "解壓失敗", details: err.message }, 500);
        }
      }

      // 💡 瀏覽器打開時會撞到呢度，保證會輸出看得見的字
      return sendJson({ error: "找不到此路徑", method: req.method, path: url.pathname }, 404);

    } catch (globalErr) {
      // 萬一連上面都壞埋，用最底層的安全字串頂住
      return new Response('{"error":"Worker崩潰","details":"' + globalErr.message + '"}', {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
