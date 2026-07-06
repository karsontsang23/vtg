// 💡 暫時拔除第一行 import，排除套件干擾

export default {
  async fetch(req, env) {
    return new Response("測試成功：Worker 網址運作正常！代表真兇真係 fflate 套件打包失敗。", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
};
