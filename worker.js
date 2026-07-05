import { unzipSync } from 'fflate';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 發出 POST：直接傳送影片檔案 (Raw Binary)
    if (req.method === "POST" && url.pathname === "/") {
      const jobId = crypto.randomUUID();
      
      // 讀取 iPhone 傳過來的影片二進位數據
      const videoBuffer = await req.arrayBuffer();
      if (videoBuffer.byteLength === 0) {
        return new Response("No video file received", { status: 400 });
      }

      // 將影片暫存到 KV (設定 1 小時自動過期)，供 GitHub 下載
      await env.GIF_DB.put(`video_${jobId}`, videoBuffer, { expirationTtl: 3600 });
      
      // 寫入 KV 任務初始狀態
      await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing", gif: null }), { expirationTtl: 3600 });

      // 觸發 GitHub Actions
      await fetch("https://api.github.com/repos/YOUR_USER/gif-ffmpeg-worker/actions/workflows/main.yml/dispatches", {
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

      // 長輪詢 (Long Polling) 等待 GitHub Webhook 更新狀態
      const startTime = Date.now();
      let job = null;

      while (Date.now() - startTime < 50000) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const data = await env.GIF_DB.get(jobId);
        if (data) {
          const currentJob = JSON.parse(data);
          if (currentJob.status === "done") {
            job = currentJob;
            break;
          }
        }
      }

      if (!job || !job.gif) {
        return Response.json({ status: "timeout_processing", job_id: jobId }, { status: 202 });
      }

      try {
        const zipRes = await fetch(job.gif);
        const zipBuffer = await zipRes.arrayBuffer();
        const unzipped = unzipSync(new Uint8Array(zipBuffer));
        const gifFileName = Object.keys(unzipped).find(name => name.endsWith('.gif'));
        
        if (!gifFileName) return new Response("GIF not found in ZIP", { status: 404 });
        
        // 轉檔成功後，刪除暫存的影片以節省 KV 空間
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

    // 💡 新增路由：供 GitHub Actions 下載剛剛上傳的影片
    if (url.pathname === "/get-video") {
      const jobId = url.searchParams.get("id");
      const videoData = await env.GIF_DB.get(`video_${jobId}`, { type: "arrayBuffer" });
      
      if (!videoData) return new Response("Video not found", { status: 404 });
      
      return new Response(videoData, {
        headers: { "Content-Type": "video/mp4" }
      });
    }

    // ② GitHub Webhook Callback
    if (url.pathname === "/callback") {
      const { job_id, gif_url } = await req.json();
      await env.GIF_DB.put(job_id, JSON.stringify({ status: "done", gif: gif_url }), { expirationTtl: 3600 });
      return Response.json({ ok: true });
    }

    // ③ 後備方案
    if (url.pathname.startsWith("/result")) {
      const jobId = url.searchParams.get("id");
      const data = await env.GIF_DB.get(jobId);
      
      if (!data) return Response.json({ status: "not_found" }, { status: 404 });
      
      const job = JSON.parse(data);
      if (job.status !== "done") return Response.json({ status: job.status });

      try {
        const zipRes = await fetch(job.gif);
        const zipBuffer = await zipRes.arrayBuffer();
        const unzipped = unzipSync(new Uint8Array(zipBuffer));
        const gifFileName = Object.keys(unzipped).find(name => name.endsWith('.gif'));
        
        if (!gifFileName) return new Response("GIF not found in ZIP", { status: 404 });
        
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
