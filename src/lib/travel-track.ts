/**
 * 「穿越時光」的配樂歌單。
 *
 * 空陣列＝沒有聲音，按鈕行為完全不變 —— 所以在音檔上傳之前，
 * 這個功能就已經是可上線的狀態，不會半殘。
 *
 * 音檔放 R2（media.jackywu.ca），不進 dist：
 *   pnpm exec wrangler r2 object put zhuiyunzhuxue-media/audio/<檔名>.mp3 \
 *     --file ./media/source/<檔名>.mp3 --content-type audio/mpeg --remote
 *
 * CSP 的 media-src 已經含 https://media.jackywu.ca，不必再改。
 * audio/ 是新前綴，sync-media --prune 只列 video/，不會誤刪。
 */
export interface TravelTrack {
  src: string;
  /** 曲名。CC-BY 之類的授權要求標示，這裡就是標示的地方 */
  title: string;
  /** 作者／授權。留空則只顯示曲名 */
  credit?: string;
}

/** 0–1。水墨底的站，聲音該是背景，不該壓過閱讀 */
export const travelVolume = 0.5;

export const travelTracks: TravelTrack[] = [];

// 上傳好之後填進來，順序就是播放順序：
// export const travelTracks: TravelTrack[] = [
//   { src: 'https://media.jackywu.ca/audio/01.mp3', title: '曲名', credit: '作者 · CC BY 4.0' },
//   { src: 'https://media.jackywu.ca/audio/02.mp3', title: '曲名', credit: '作者 · CC BY 4.0' },
// ];
