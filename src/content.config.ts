import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { DURATION_RE, STARTED_AT_RE, displayWidth } from '../packages/content-rules/index.ts';

/**
 * 內容來源。git（預設）＝ src/content 裡的 MDX/YAML；
 * payload ＝ scripts/fetch-content.mjs 從後台拉下來、整理成 JSON 的 src/content/payload。
 * 兩邊的欄位規則同一份，差別只在正文：MDX 是編譯後的元件，payload 是 `body` 區塊樹。
 */
const PAYLOAD = process.env.CONTENT_SOURCE === 'payload';
const dir = (name: string) => (PAYLOAD ? `./src/content/payload/${name}` : `./src/content/${name}`);

/**
 * 六個 realm。前四個是行當，進時光機；
 * forge 爐火（舊技術文）與 still 靜（私人文）不進。
 */
const REALM = z.enum(['run', 'snow', 'road', 'wild', 'forge', 'still']);

/**
 * 顯示寬度與長度規則。前台與後台共用同一份（packages/content-rules），
 * 規則只能活在一處：後台放行、前台建置失敗是無人值守發佈最壞的一種失敗。
 */
const width = displayWidth;
const TRADE = z.enum(['run', 'snow', 'road', 'wild']);

/** 文章 */
const tales = defineCollection({
  // 同時吃 .md —— 舊站漏掉 3 篇就是因為 glob 只吃 .mdx
  loader: glob(PAYLOAD
    ? { base: dir('tales'), pattern: '**/index.json', generateId: ({ entry }) => entry.replace(/\/index\.json$/, '') }
    : { base: dir('tales'), pattern: '**/index.{md,mdx}' }),
  schema: ({ image }) =>
    z
      .object({
        // payload 模式才有：正文區塊樹，與區塊引用的圖（id → 圖片）
        body: z.array(z.any()).optional(),
        media: z.record(z.string(), image()).default({}),
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
        /** 用文章路線（route）的軌跡圖當封面：前台內嵌向量圖，分享圖也用它。和 hero 二選一 */
        heroRoute: z.boolean().optional(),
        video: reference('reel').optional(),
        route: reference('routes').optional(),

        legacy: z
          .object({
            url: z.string().startsWith('/blog/'),
            brokenImages: z.array(z.string().url()).default([]),
          })
          .optional(),
      })
      .refine((d) => !((d.hero || d.heroRoute) && !d.heroAlt), {
        message: 'hero 存在時必須提供 heroAlt（無障礙要求）',
        path: ['heroAlt'],
      })
      .refine((d) => !(d.heroRoute && !d.route), { message: 'heroRoute 要有 route：用哪一條路線的軌跡當封面', path: ['heroRoute'] })
      .refine((d) => !(d.heroRoute && d.hero), { message: '封面只能擇一：hero 圖片或 heroRoute 路線圖', path: ['heroRoute'] })
      .refine((d) => !(d.realm === 'still' && d.shareable), {
        message: 'realm: still 必須 shareable: false —— 私人文不產分享海報',
        path: ['shareable'],
      }),
});

/** 輿圖：路線／賽事。多數沒有正文，只有數據 */
const routes = defineCollection({
  loader: glob({ base: dir('routes'), pattern: PAYLOAD ? '**/*.json' : '**/*.yaml' }),
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
      /** 移動時間（不含停下來的時間），FIT 檔帶來的，如 PT2H31M */
      movingTime: z.string().regex(DURATION_RE).optional(),
      /** 開始時間：當地時間＋時區，如 2026-08-16T06:05-07:00 */
      startedAt: z.string().regex(STARTED_AT_RE).optional(),
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
  loader: glob({ base: dir('reel'), pattern: PAYLOAD ? '**/*.json' : '**/*.yaml' }),
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

/**
 * 譯文。
 *
 * 刻意獨立成一個 collection，而不是併進 tales 用 refine 分流：
 *  · tales 的 id 一個字都不會動 —— 29 篇文章的網址與 57 條轉址不受影響
 *  · 譯文的 schema 本來就不一樣（沒有 date/realm/hero，那些一律繼承正本），
 *    分開寫比在一份 schema 裡堆條件式誠實
 *
 * 檔名決定一切，不必也不准在 frontmatter 重寫：
 *   2019/foo/index.mdx      → tales 的 2019/foo（正本，lang 宣告它是哪國話）
 *   2019/foo/index.en.mdx   → 這裡的 2019/foo:en
 * 兩個 glob 不重疊：`index.{md,mdx}` 沒有中綴，`index.*.{md,mdx}` 一定有。
 */
const taleTranslations = defineCollection({
  loader: glob({
    // 譯文一律在 git（翻譯在對話裡做，見 docs/translation.md）：payload 模式下 dir('tales') 指向後台內容，
    // 那裡沒有 index.en.mdx，譯文會整批消失
    base: './src/content/tales',
    pattern: '**/index.*.{md,mdx}',
    // 冒號只活在 id 裡，網址是由「正本 id + 語言前綴」組出來的，不會外流
    generateId: ({ entry }) => entry.replace(/\/index\.([\w-]+)\.mdx?$/, ':$1'),
  }),
  schema: z.object({
    /** full = 連正文一起譯；meta = 只譯標題摘要，不產生獨立網址 */
    scope: z.enum(['full', 'meta']).default('full'),
    /** draft 的譯文帶 noindex、不進 sitemap、不進 hreflang */
    status: z.enum(['draft', 'reviewed']).default('draft'),
    /** 機器起草時記一筆，人譯的留空 */
    engine: z.string().optional(),

    title: z.string().refine((v) => width(v) <= 120, '標題太長'),
    excerpt: z.string().refine((v) => width(v) >= 20 && width(v) <= 200, '摘要長度要在 20–200 顯示寬之間'),
    verse: z.string().refine((v) => width(v) <= 80, '金句太長').optional(),
    /** 不寫就繼承正本 */
    tags: z.array(z.string()).optional(),
  })
    // 這些一律繼承正本。兩邊各寫一份，遲早對不上，所以直接擋掉
    .strict(),
});

export const collections = { tales, taleTranslations, routes, reel, pages };
