/**
 * 逾時預算：來自實測分布，不是感覺。數字變了就重量，不要順手加大。
 *
 * 量法：playwright test e2e/search.spec.ts --repeat-each=N --workers=1 --reporter=json，
 * 讀每次的 search-ms annotation（從第一個按鍵到結果可見）。
 *
 *   2026-09-23  wrangler dev   n=20  p50 847ms   max 862ms
 *   2026-09-23  jackywu.ca     n=10  p50 1849ms  max 3888ms   ← 冷啟動要從網路抓索引
 *
 * 線上只有 n=10，max 當 p99 用；預算取約 4 倍 max 留給 GitHub runner 與邊緣的差異。
 * 超過預算要先問「為什麼變慢」，不是改這個數字。
 */
const onProd = process.argv.includes('--project=prod');

export const BUDGET = {
  searchResults: onProd ? 15_000 : 5_000,
  /**
   * 部署後線上換成這一版要多久。尚未量測：Workers 部署宣稱近乎即時，
   * 第一次上線時曾在 deploy 完成後立刻 curl 到新版。deployed.spec.ts 會把實際等待
   * 記成 propagation-ms annotation —— 累積幾次部署後，用那些數字改寫這一行。
   */
  deployPropagation: 60_000,
} as const;
