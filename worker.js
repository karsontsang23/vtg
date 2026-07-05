import { unzipSync } from 'fflate';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 建立 Job (保持不變)
    if (req.method === "POST") {
      const { video_url } = await req.json();
      const jobId = crypto.randomUUID(); //[span_2](start_span)[span_2](end_span)
      
      await env.GIF_DB.put(jobId, JSON.stringify({ status: "processing", gif: null }), { expirationTtl: 3600 });

      await fetch("https://api.github.com/repos/YOUR_USER/gif-ffmpeg-worker/actions/workflows/gif.yml/dispatches", {
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

      return Response.json({ job_id: jobId }); //[span_3](start_span)[span_3](end_span)
    }

    // ② GitHub Webhook Callback (保持不變)
    if (url.pathname === "/callback") {
      const { job_id, gif_url } = await req.json();
      await env.GIF_DB.put(job_id, JSON.stringify({ status: "done", gif: gif_url }), { expirationTtl: 3600 });
      return Response.json({ ok: true }); //[span_4](start_span)[span_4](end_span)
    }

    // ③ iPhone 檢查結果 (💡 受影響代碼修改：在雲端完成解壓並直接回傳 GIF)
    if (url.pathname.startsWith("/result")) { //[span_5](start_span)[span_5](end_span)
      const jobId = url.searchParams.get("id");
      const data = await env.GIF_DB.get(jobId);
      
      if (!data) return Response.json({ status: "not_found" }, { status: 404 });
      
      const job = JSON.parse(data);
      if (job.status !== "done") {
        return Response.json({ status: job.status });
      }

      try {
        // 1. 下載由 nightly.link 提供的公開 ZIP 檔
        const zipRes = await fetch(job.gif);
        const zipBuffer = await zipRes.arrayBuffer();
        
        // 2. 解壓 ZIP 檔案內容
        const unzipped = unzipSync(new Uint8Array(zipBuffer));
        
        // 3. 找出入面的 GIF 檔案
        const gifFileName = Object.keys(unzipped).find(name => name.endsWith('.gif'));
        if (!gifFileName) {
          return new Response("GIF not found in ZIP", { status: 404 });
        }
        
        const gifBytes = unzipped[gifFileName];

        // 4. 直接傳送純 GIF 檔案給 iPhone
        return new Response(gifBytes, {
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
