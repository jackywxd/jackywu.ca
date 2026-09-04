/** R2 上的媒體。bucket 公開讀，走自訂網域，零流出費。 */
export const MEDIA_ORIGIN = 'https://media.jackywu.ca';
export const videoUrl = (id: string, rendition = '1080p') => `${MEDIA_ORIGIN}/video/${id}/${rendition}.mp4`;
