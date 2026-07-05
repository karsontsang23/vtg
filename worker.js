const db = new Map();

export default {
  // 在 Cloudflare Workers 中，環境變數會作為 fetch 的第二個參數 env 傳入
  async fetch(req, env) {
    const url = new URL(req.url);

    // ① iPhone 建立 Job
    if (req.method === "POST") {
      const { video_url } = await req.json();
      const jobId = crypto.randomUUID();
      
      db.set(jobId, { status: "processing", gif: null });

      // 觸發 GitHub Actions
      await fetch("https://api.github.com/repos/YOUR_USER/gif-ffmpeg-worker/actions/workflows/gif.yml/dispatches", {
        method: "POST",
        headers: {
          // 💡 受影響代碼修改：改為從 env.GITHUB_TOKEN 讀取環境變數
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "Cloudflare-Worker"
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { video_url, job_id: jobId }
        })
      });

      return Response.json({ job_id: jobId });
    }

    // ② GitHub Webhook Callback
    if (url.pathname === "/callback") {
      const body = await req.json();
      const { job_id, gif_url } = body;
      
      if (db.has(job_id)) {
        db.set(job_id, { status: "done", gif: gif_url });
      }
      return Response.json({ ok: true });
    }

    // ③ iPhone 檢查結果
    if (url.pathname.startsWith("/result")) {
      const jobId = url.searchParams.get("id");
      const job = db.get(jobId);
      
      if (!job) {
        return Response.json({ status: "not_found", gif: null }, { status: 404 });
      }
      return Response.json(job);
    }

    return new Response("Not Found", { status: 404 });
  }
};
