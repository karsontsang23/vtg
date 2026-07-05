import { unzipSync } from 'fflate';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 發出 POST：建立任務 ＋ 同步等待轉檔結果 ＋ 直接傳回解壓後的 GIF
    if (req.method === "POST") {
      const { video_url } = await req.json();
      const jobId = crypto.randomUUID();
      
      // 寫入 KV 儲存初始狀態
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
          inputs: { video_url, job_id: jobId }
        })
      });

      // 💡 核心修改：長輪詢 (Long Polling) 等待 GitHub Webhook 更新狀態
      const startTime = Date.now();
      let job = null;

      while (Date.now() - startTime < 50000) { // 最多等 50 秒，避免觸發 iPhone Shortcuts 的 60 秒超時限制
        await new Promise(resolve => setTimeout(resolve, 3000)); // 每 3 秒檢查一次 KV 狀態
        
        const data = await env.GIF_DB.get(jobId);
        if (data) {
          const currentJob = JSON.parse(data);
          if (currentJob.status === "done") {
            job = currentJob;
            break;
          }
        }
      }

      // 【後備機制】如果不幸超過 50 秒都未完，先回傳 job_id，讓 iPhone 之後可以用 GET 去 /result 拿取
      if (!job || !job.gif) {
        return Response.json({ status: "timeout_processing", job_id: jobId }, { status: 202 });
      }

      // 順利在時間內完成，直接在雲端下載 ZIP、解壓，並將純 GIF 數據塞回給 iPhone
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

    // ② GitHub Webhook Callback (負責接收 nightly.link 網址並寫入 KV，用來打破上面的 while loop)
    if (url.pathname === "/callback") {
      const { job_id, gif_url } = await req.json();
      await env.GIF_DB.put(job_id, JSON.stringify({ status: "done", gif: gif_url }), { expirationTtl: 3600 });
      return Response.json({ ok: true });
    }

    // ③ 後備方案：如果上面 POST 不幸超時，iPhone 捷徑可以拿著 job_id 來這裡 GET 檔案
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
