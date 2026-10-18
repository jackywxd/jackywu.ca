/**
 * 路線的三張 SVG（軌跡、縮圖、海拔剖面）：建置期讀入，內嵌進頁面，不另發請求。
 *
 * 一定要依內容來源讀對的資料夾：git 模式在 src/content/routes，後台模式在 src/content/payload/routes。
 * 早先四個地方各自只 glob 了 git 的資料夾——後台模式下，線上的路線頁看起來正常只是因為 git 裡還留著同名的舊檔；
 * 在後台新建的路線，頁面、時間軸、輿圖列表與分享圖都會沒有軌跡。全部改用這裡。
 */
const files = import.meta.glob<string>(['/src/content/routes/**/*.svg', '/src/content/payload/routes/**/*.svg'], {
  query: '?raw', import: 'default', eager: true,
});
const BASE = process.env.CONTENT_SOURCE === 'payload' ? '/src/content/payload/routes' : '/src/content/routes';
const SUFFIX = { track: '.svg', thumb: '.thumb.svg', profile: '.profile.svg' } as const;

/** 原始 SVG 檔 */
export const routeSvgRaw = (id: string, kind: keyof typeof SUFFIX) => files[`${BASE}/${id}${SUFFIX[kind]}`];

/** 去掉外層 <svg> 與會在同一頁重複的 id，給 set:html 內嵌 */
export const routeSvgInner = (id: string, kind: keyof typeof SUFFIX) =>
  routeSvgRaw(id, kind)?.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\sid="[^"]*"/g, '');

/** 軌跡的 path d（分享圖用） */
export const routeTrackD = (id: string) => routeSvgRaw(id, 'track')?.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
