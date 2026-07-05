import { unzipSync } from 'fflate';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 建立 Job
    if (req.method === "POST") {
      const { video_url } = await req.json();
      const jobId = crypto.randomUUID(); //[span_1](start_span)[span_1](end_span)
      
      // 寫入 KV 儲存狀態 (設定 1 小時自動過期)
      await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing", gif: null }), { expirationTtl: 3600 });

      // 觸發 GitHub Actions (已指向 main.yml)
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

      return Response.json({ job_id: jobId }); //[span_2](start_span)[span_2](end_span)
    }

    // ② GitHub Webhook Callback
    if (url.pathname === "/callback") {
      const { job_id, gif_url } = await req.json();
      await env.GIF_DB.put(job_id, JSON.stringify({ status: "done", gif: gif_url }), { expirationTtl: 3600 });
      return Response.json({ ok: true }); //[span_3](start_span)[span_3](end_span)
    }

    // ③ iPhone 檢查結果並自動解壓
    if (url.pathname.startsWith("/result")) { //[span_4](start_span)[span_4](end_span)
      const jobId = url.searchParams.get("id");
      const data = await env.GIF_DB.get(jobId);
      
      if (!data) return Response.json({ status: "not_found" }, { status: 404 });
      
      const job = JSON.parse(data);
      if (job.status !== "done") {
        return Response.json({ status: job.status });
      }

      try {
        // 1. 抓取 nightly.link 產出的公開 ZIP
        const zipRes = await fetch(job.gif);
        const zipBuffer = await zipRes.arrayBuffer();
        
        // 2. 解壓 ZIP
        const unzipped = unzipSync(new Uint8Array(zipBuffer));
        const gifFileName = Object.keys(unzipped).find(name => name.endsWith('.gif'));
        
        if (!gifFileName) return new Response("GIF not found in ZIP", { status: 404 });
        
        // 3. 直接以 image/gif 格式串流回傳給 iPhone
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
