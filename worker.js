import { unzipSync } from 'fflate';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 發出 POST：上傳影片，起動任務，並「即時」回傳 job_id 避免超時
    if (req.method === "POST" && url.pathname === "/") {
      const jobId = crypto.randomUUID();
      
      const videoBuffer = await req.arrayBuffer();
      if (videoBuffer.byteLength === 0) {
        return new Response("No video file received", { status: 400 });
      }

      // 暫存影片到 KV
      await env.GIF_DB.put(`video_${jobId}`, videoBuffer, { expirationTtl: 3600 });
      
      // 寫入初始狀態
      await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing", gif: null }), { expirationTtl: 3600 });

      // 觸發 GitHub Actions
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
        return new Response("Failed to trigger GitHub Action", { status: 500 });
      }

      // 💡 唔好喺度等，直接將 ID 傳返畀 iPhone
      return new Response(JSON.stringify({ job_id: jobId }), {
        headers: { "Content-Type": "application/json" }
      });
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
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // ③ iPhone 拿着 job_id 來這裡檢查並下載 GIF
    if (url.pathname.startsWith("/result")) {
      const jobId = url.searchParams.get("id");
      if (!jobId) return new Response("Missing id", { status: 400 });

      const data = await env.GIF_DB.get(jobId);
      if (!data) return new Response(JSON.stringify({ status: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
      
      const job = JSON.parse(data);
      
      // 如果未轉完，回傳狀態讓 iPhone 繼續等
      if (job.status !== "done") {
        return new Response(JSON.stringify({ status: job.status }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      try {
        const zipRes = await fetch(job.gif);
        const zipBuffer = await zipRes.arrayBuffer();
        const unzipped = unzipSync(new Uint8Array(zipBuffer));
        const gifFileName = Object.keys(unzipped).find(name => name.endsWith('.gif'));
        
        if (!gifFileName) return new Response("GIF not found in ZIP", { status: 404 });
        
        // 成功後清理 KV 影片
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
