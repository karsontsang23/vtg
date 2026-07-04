
VERSION 4 GIF SYSTEM

FLOW:
iPhone Shortcut -> Cloudflare Worker -> GitHub Actions -> GIF

ENDPOINTS:
POST /  -> create job
GET /result?id=xxx -> get GIF

YOU NEED TO:
- replace YOUR_USER
- replace YOUR_GITHUB_TOKEN
- connect Cloudflare Worker
- set GitHub Actions secret
