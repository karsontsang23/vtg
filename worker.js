// 使用 Cloudflare KV 或 Durable Objects 是最佳做法，這裡先以全域 Map 作為記憶體快取（注意：生產環境建議綁定 KV）
const db = new Map();

export default {
  async fetch(req) {
    const url = new URL(req.url);

    // ① iPhone 建立 Job
    if (req.method === "POST") {
      const { video_url } = await req.json();
      const jobId = crypto.randomUUID();
      
      // 初始化狀態
      db.set(jobId, { status: "processing", gif: null });

      // 觸發 GitHub Actions
      await fetch("https://api.github.com/repos/YOUR_USER/gif-ffmpeg-worker/actions/workflows/gif.yml/dispatches", {
        method: "POST",
        headers: {
          "Authorization": "Bearer YOUR_GITHUB_TOKEN",
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

    // ② GitHub Webhook Callback (補齊接收與寫入狀態)
    if (url.pathname === "/callback") {
      const body = await req.json();
      const { job_id, gif_url } = body;
      
      if (db.has(job_id)) {
        db.set(job_id, { status: "done", gif: gif_url });
      }
      return Response.json({ ok: true });
    }

    // ③ iPhone 檢查結果 (補齊動態讀取真實狀態)
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
