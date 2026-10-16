/**
 * 虛擬鍵盤高度。iOS Safari 開鍵盤時不縮小版面，只縮小 visualViewport；
 * 工具列要貼在鍵盤正上方，就得自己算被遮住的那一塊。
 */
export function keyboardInset(layoutHeight: number, vv: { height: number; offsetTop: number }): number {
  const covered = layoutHeight - vv.height - vv.offsetTop;
  // 小於 80px 多半是網址列伸縮、不是鍵盤，不要讓工具列跟著抖
  return covered >= 80 ? Math.round(covered) : 0;
}
