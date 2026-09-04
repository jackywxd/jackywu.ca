import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 六個 realm。前四個是行當，進時光機；
 * forge 爐火（舊技術文）與 still 靜（私人文）不進。
 */
const REALM = z.enum(['run', 'snow', 'road', 'wild', 'forge', 'still']);

/**
 * 顯示寬度：中日韓字算 2，其餘算 1。
 *
 * 用字元數當長度限制對中文是錯的 —— 15 個中文字的資訊量遠超過 20 個英文字元，
 * 而 120 個中文字塞不進微信的卡片描述。兩種語言要用同一把尺量，
 * 那把尺是「佔多寬」而不是「幾個字」。
 */
const width = (s: string) => [...s].reduce(
  (n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1),
  0,
);
const TRADE = z.enum(['run', 'snow', 'road', 'wild']);

/** 文章 */
const tales = defineCollection({
  // 同時吃 .md —— 舊站漏掉 3 篇就是因為 glob 只吃 .mdx
  loader: glob({ base: './src/content/tales', pattern: '**/index.{md,mdx}' }),
  schema: ({ image }) =>
    z
      .object({
        // 長度一律用顯示寬度量（中文字算 2），中英才有同一把尺
        title: z.string().min(1).refine((v) => width(v) <= 120, '標題太長（顯示寬度上限 120，約 60 個中文字）'),
        date: z.coerce.date(),
        updated: z.coerce.date().optional(),
        draft: z.boolean().default(false),
        lang: z.enum(['zh-Hant', 'en']).default('zh-Hant'),

        realm: REALM,
        tags: z.array(z.string()).default([]),
        featured: z.boolean().default(false),

        /**
         * 給機器讀：meta description / RSS / 卡片。必填是刻意的 —— 舊站 28 篇一篇都沒有。
         * 上限 200 是照微信卡片描述的截斷點（約 100 個中文字）抓的。
         */
        excerpt: z.string()
          .refine((v) => width(v) >= 20, '摘要太短（顯示寬度至少 20，約 10 個中文字）')
          .refine((v) => width(v) <= 200, '摘要太長（顯示寬度上限 200，約 100 個中文字）'),
        /** 給人看：海報主視覺上的鉤子。與 excerpt 分開，混用兩邊都不好 */
        verse: z.string().refine((v) => width(v) <= 80, '金句太長（顯示寬度上限 80，約 40 個中文字）').optional(),

        shareable: z.boolean().default(true),
        xhsTags: z.array(z.string()).optional(),

        hero: image().optional(),
        heroAlt: z.string().optional(),
        video: reference('reel').optional(),
        route: reference('routes').optional(),

        legacy: z
          .object({
            url: z.string().startsWith('/blog/'),
            brokenImages: z.array(z.string().url()).default([]),
          })
          .optional(),
      })
      .refine((d) => !(d.hero && !d.heroAlt), {
        message: 'hero 存在時必須提供 heroAlt（無障礙要求）',
        path: ['heroAlt'],
      })
      .refine((d) => !(d.realm === 'still' && d.shareable), {
        message: 'realm: still 必須 shareable: false —— 私人文不產分享海報',
        path: ['shareable'],
      }),
});

/** 輿圖：路線／賽事。多數沒有正文，只有數據 */
const routes = defineCollection({
  loader: glob({ base: './src/content/routes', pattern: '**/*.yaml' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      nameEn: z.string().optional(),
      realm: TRADE,
      date: z.coerce.date(),
      /** 相對於此 yaml 的 gpx 檔名。沒有軌跡的條目可省略 */
      gpx: z.string().endsWith('.gpx').optional(),
      region: z.string(),
      distanceKm: z.number().positive().optional(),
      gainM: z.number().nonnegative().optional(),
      /** ISO 8601 duration，如 PT21H47M */
      elapsed: z.string().regex(/^P/).optional(),
      result: z.string().optional(),
      /** 賽事徽記，如 UTW · 100K · 2026 */
      badge: z.string().optional(),
      note: z.string().max(200).optional(),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      downloadable: z.boolean().default(true),
    }),
});

/** 影：R2 上的影片 */
const reel = defineCollection({
  loader: glob({ base: './src/content/reel', pattern: '**/*.yaml' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** → https://media.jackywu.ca/video/<id>/1080p.mp4 */
      id: z.string().regex(/^[a-z0-9-]+$/),
      poster: image(),
      posterAlt: z.string(),
      duration: z.number().int().positive(),
      /** 位元組，用來在 figcaption 標「約 32 MB」 */
      bytes: z.number().int().positive(),
      ratio: z.enum(['16/9', '9/16', '4/3', '1/1']).default('16/9'),
      realm: TRADE,
      date: z.coerce.date(),
      caption: z.string().max(120).optional(),
    }),
});

/**
 * 單頁：掌櫃、江湖規矩之類。
 * 這些內容本來硬編在 .astro 裡 —— 要改一段自我介紹得去編輯程式碼，那是錯的。
 */
const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** 標題底下那一行。選填 */
      subtitle: z.string().optional(),
      excerpt: z.string().refine((v) => width(v) >= 20, '摘要太短（顯示寬度至少 20）'),
      updated: z.coerce.date().optional(),
      hero: image().optional(),
      heroAlt: z.string().optional(),
    }),
});

export const collections = { tales, routes, reel, pages };
