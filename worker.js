
export default {
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST") {
      const { video_url } = await req.json();
      const jobId = crypto.randomUUID();

      await fetch("https://api.github.com/repos/karsontsang23/vtg/actions/workflows/gif.yml/dispatches", {
        method: "POST",
        headers: {
          "Authorization": "Bearer YOUR_GITHUB_TOKEN",
          "Accept": "application/vnd.github+json"
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { video_url, job_id: jobId }
        })
      });

      return Response.json({ job_id: jobId });
    }

    if (url.pathname === "/callback") {
      const body = await req.json();
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/result")) {
      return Response.json({ status: "done", gif: "https://YOUR_CDN/output.gif" });
    }
  }
};
