// 反爬挑战页识别（ADR 0002/0003）：已知挑战网关域名，或"小页面 + 验证关键词"。
// 豆瓣对无浏览器特征的请求会 302 到 sec.douban.com 安全校验页；Cloudflare 一类
// 网关则是 "Checking your browser" 等待页。裸 fetch 的 networkidle 时序不可靠，
// 两个抓取工具都用落地结果判断是否仍被拦截。
const CHALLENGE_HOSTS = ['sec.douban.com'];
const CHALLENGE_PATTERN =
  /安全检查|安全验证|checking your browser|just a moment|verify you are/i;

export function looksLikeChallengePage(url: string, html: string): boolean {
  const host = URL.parse(url)?.host ?? '';
  if (CHALLENGE_HOSTS.includes(host)) return true;
  return html.length < 20_000 && CHALLENGE_PATTERN.test(html);
}
