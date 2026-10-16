import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`role\` text DEFAULT 'owner' NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`email\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`reset_password_requested_at\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`media\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`alt\` text NOT NULL,
  	\`sha256\` text,
  	\`kind\` text DEFAULT 'img' NOT NULL,
  	\`usage\` text DEFAULT 'attachment',
  	\`_objectkey\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`media_sha256_idx\` ON \`media\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`tales\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text,
  	\`slug\` text,
  	\`date\` text,
  	\`updated\` text,
  	\`realm\` text,
  	\`lang\` text DEFAULT 'zh-Hant',
  	\`featured\` integer DEFAULT false,
  	\`excerpt\` text,
  	\`verse\` text,
  	\`shareable\` integer DEFAULT true,
  	\`hero_id\` integer,
  	\`hero_alt\` text,
  	\`video_id\` integer,
  	\`route_id\` integer,
  	\`legacy_url\` text,
  	\`content\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`hero_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`video_id\`) REFERENCES \`reels\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`route_id\`) REFERENCES \`routes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`tales_slug_idx\` ON \`tales\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`tales_hero_idx\` ON \`tales\` (\`hero_id\`);`)
  await db.run(sql`CREATE INDEX \`tales_video_idx\` ON \`tales\` (\`video_id\`);`)
  await db.run(sql`CREATE INDEX \`tales_route_idx\` ON \`tales\` (\`route_id\`);`)
  await db.run(sql`CREATE INDEX \`tales_updated_at_idx\` ON \`tales\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tales_created_at_idx\` ON \`tales\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`tales__status_idx\` ON \`tales\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`tales_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`text\` text,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tales\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tales_texts_order_parent\` ON \`tales_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_tales_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_title\` text,
  	\`version_slug\` text,
  	\`version_date\` text,
  	\`version_updated\` text,
  	\`version_realm\` text,
  	\`version_lang\` text DEFAULT 'zh-Hant',
  	\`version_featured\` integer DEFAULT false,
  	\`version_excerpt\` text,
  	\`version_verse\` text,
  	\`version_shareable\` integer DEFAULT true,
  	\`version_hero_id\` integer,
  	\`version_hero_alt\` text,
  	\`version_video_id\` integer,
  	\`version_route_id\` integer,
  	\`version_legacy_url\` text,
  	\`version_content\` text,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tales\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_hero_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_video_id\`) REFERENCES \`reels\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_route_id\`) REFERENCES \`routes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_tales_v_parent_idx\` ON \`_tales_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version_slug_idx\` ON \`_tales_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version_hero_idx\` ON \`_tales_v\` (\`version_hero_id\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version_video_idx\` ON \`_tales_v\` (\`version_video_id\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version_route_idx\` ON \`_tales_v\` (\`version_route_id\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version_updated_at_idx\` ON \`_tales_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version_created_at_idx\` ON \`_tales_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version__status_idx\` ON \`_tales_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_created_at_idx\` ON \`_tales_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_updated_at_idx\` ON \`_tales_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_tales_v_latest_idx\` ON \`_tales_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`_tales_v_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`text\` text,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_tales_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_tales_v_texts_order_parent\` ON \`_tales_v_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`pages\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text,
  	\`slug\` text,
  	\`subtitle\` text,
  	\`excerpt\` text,
  	\`updated\` text,
  	\`hero_id\` integer,
  	\`hero_alt\` text,
  	\`content\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`hero_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`pages_slug_idx\` ON \`pages\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`pages_hero_idx\` ON \`pages\` (\`hero_id\`);`)
  await db.run(sql`CREATE INDEX \`pages_updated_at_idx\` ON \`pages\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`pages_created_at_idx\` ON \`pages\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`pages__status_idx\` ON \`pages\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`_pages_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_title\` text,
  	\`version_slug\` text,
  	\`version_subtitle\` text,
  	\`version_excerpt\` text,
  	\`version_updated\` text,
  	\`version_hero_id\` integer,
  	\`version_hero_alt\` text,
  	\`version_content\` text,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_hero_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_pages_v_parent_idx\` ON \`_pages_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_version_version_slug_idx\` ON \`_pages_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_version_version_hero_idx\` ON \`_pages_v\` (\`version_hero_id\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_version_version_updated_at_idx\` ON \`_pages_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_version_version_created_at_idx\` ON \`_pages_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_version_version__status_idx\` ON \`_pages_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_created_at_idx\` ON \`_pages_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_updated_at_idx\` ON \`_pages_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_latest_idx\` ON \`_pages_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`routes\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`slug\` text,
  	\`name_en\` text,
  	\`realm\` text,
  	\`date\` text,
  	\`region\` text,
  	\`gpx_id\` integer,
  	\`distance_km\` numeric,
  	\`gain_m\` numeric,
  	\`elapsed\` text,
  	\`result\` text,
  	\`badge\` text,
  	\`note\` text,
  	\`cover_id\` integer,
  	\`cover_alt\` text,
  	\`downloadable\` integer DEFAULT true,
  	\`svg_track\` text,
  	\`svg_thumb\` text,
  	\`svg_profile\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`gpx_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`cover_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`routes_slug_idx\` ON \`routes\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`routes_gpx_idx\` ON \`routes\` (\`gpx_id\`);`)
  await db.run(sql`CREATE INDEX \`routes_cover_idx\` ON \`routes\` (\`cover_id\`);`)
  await db.run(sql`CREATE INDEX \`routes_updated_at_idx\` ON \`routes\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`routes_created_at_idx\` ON \`routes\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`routes__status_idx\` ON \`routes\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`_routes_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_name\` text,
  	\`version_slug\` text,
  	\`version_name_en\` text,
  	\`version_realm\` text,
  	\`version_date\` text,
  	\`version_region\` text,
  	\`version_gpx_id\` integer,
  	\`version_distance_km\` numeric,
  	\`version_gain_m\` numeric,
  	\`version_elapsed\` text,
  	\`version_result\` text,
  	\`version_badge\` text,
  	\`version_note\` text,
  	\`version_cover_id\` integer,
  	\`version_cover_alt\` text,
  	\`version_downloadable\` integer DEFAULT true,
  	\`version_svg_track\` text,
  	\`version_svg_thumb\` text,
  	\`version_svg_profile\` text,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`routes\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_gpx_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_cover_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_routes_v_parent_idx\` ON \`_routes_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_version_version_slug_idx\` ON \`_routes_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_version_version_gpx_idx\` ON \`_routes_v\` (\`version_gpx_id\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_version_version_cover_idx\` ON \`_routes_v\` (\`version_cover_id\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_version_version_updated_at_idx\` ON \`_routes_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_version_version_created_at_idx\` ON \`_routes_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_version_version__status_idx\` ON \`_routes_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_created_at_idx\` ON \`_routes_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_updated_at_idx\` ON \`_routes_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_routes_v_latest_idx\` ON \`_routes_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`reels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text,
  	\`video_id\` text,
  	\`poster_id\` integer,
  	\`poster_alt\` text,
  	\`duration\` numeric,
  	\`bytes\` numeric,
  	\`ratio\` text DEFAULT '16/9',
  	\`realm\` text,
  	\`date\` text,
  	\`caption\` text,
  	\`transcode_status\` text DEFAULT 'none',
  	\`transcode_attempts\` numeric DEFAULT 0,
  	\`transcode_error\` text,
  	\`transcode_source_key\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`poster_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`reels_video_id_idx\` ON \`reels\` (\`video_id\`);`)
  await db.run(sql`CREATE INDEX \`reels_poster_idx\` ON \`reels\` (\`poster_id\`);`)
  await db.run(sql`CREATE INDEX \`reels_updated_at_idx\` ON \`reels\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`reels_created_at_idx\` ON \`reels\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`reels__status_idx\` ON \`reels\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`_reels_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_title\` text,
  	\`version_video_id\` text,
  	\`version_poster_id\` integer,
  	\`version_poster_alt\` text,
  	\`version_duration\` numeric,
  	\`version_bytes\` numeric,
  	\`version_ratio\` text DEFAULT '16/9',
  	\`version_realm\` text,
  	\`version_date\` text,
  	\`version_caption\` text,
  	\`version_transcode_status\` text DEFAULT 'none',
  	\`version_transcode_attempts\` numeric DEFAULT 0,
  	\`version_transcode_error\` text,
  	\`version_transcode_source_key\` text,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`reels\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_poster_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_reels_v_parent_idx\` ON \`_reels_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_version_version_video_id_idx\` ON \`_reels_v\` (\`version_video_id\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_version_version_poster_idx\` ON \`_reels_v\` (\`version_poster_id\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_version_version_updated_at_idx\` ON \`_reels_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_version_version_created_at_idx\` ON \`_reels_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_version_version__status_idx\` ON \`_reels_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_created_at_idx\` ON \`_reels_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_updated_at_idx\` ON \`_reels_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_reels_v_latest_idx\` ON \`_reels_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`redirects\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`from\` text NOT NULL,
  	\`to\` text NOT NULL,
  	\`reason\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`redirects_from_idx\` ON \`redirects\` (\`from\`);`)
  await db.run(sql`CREATE INDEX \`redirects_updated_at_idx\` ON \`redirects\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`redirects_created_at_idx\` ON \`redirects\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`publish_requests\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`request_id\` text NOT NULL,
  	\`kind\` text NOT NULL,
  	\`collection_slug\` text NOT NULL,
  	\`doc_id\` text NOT NULL,
  	\`version_id\` text NOT NULL,
  	\`status\` text DEFAULT 'queued' NOT NULL,
  	\`attempts\` numeric DEFAULT 0,
  	\`created_at_ms\` numeric NOT NULL,
  	\`dispatched_at_ms\` numeric,
  	\`finished_at_ms\` numeric,
  	\`failure\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`publish_requests_request_id_idx\` ON \`publish_requests\` (\`request_id\`);`)
  await db.run(sql`CREATE INDEX \`publish_requests_doc_id_idx\` ON \`publish_requests\` (\`doc_id\`);`)
  await db.run(sql`CREATE INDEX \`publish_requests_status_idx\` ON \`publish_requests\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`publish_requests_updated_at_idx\` ON \`publish_requests\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`publish_requests_created_at_idx\` ON \`publish_requests\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`promoted\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`request_id\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`promoted_key_idx\` ON \`promoted\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`promoted_updated_at_idx\` ON \`promoted\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`promoted_created_at_idx\` ON \`promoted\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`global_slug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	\`tales_id\` integer,
  	\`pages_id\` integer,
  	\`routes_id\` integer,
  	\`reels_id\` integer,
  	\`redirects_id\` integer,
  	\`publish_requests_id\` integer,
  	\`promoted_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tales_id\`) REFERENCES \`tales\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`pages_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`routes_id\`) REFERENCES \`routes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`reels_id\`) REFERENCES \`reels\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`redirects_id\`) REFERENCES \`redirects\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`publish_requests_id\`) REFERENCES \`publish_requests\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`promoted_id\`) REFERENCES \`promoted\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tales_id_idx\` ON \`payload_locked_documents_rels\` (\`tales_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`pages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_routes_id_idx\` ON \`payload_locked_documents_rels\` (\`routes_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_reels_id_idx\` ON \`payload_locked_documents_rels\` (\`reels_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_redirects_id_idx\` ON \`payload_locked_documents_rels\` (\`redirects_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_publish_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`publish_requests_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_promoted_id_idx\` ON \`payload_locked_documents_rels\` (\`promoted_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`value\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`batch\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`DROP TABLE \`tales\`;`)
  await db.run(sql`DROP TABLE \`tales_texts\`;`)
  await db.run(sql`DROP TABLE \`_tales_v\`;`)
  await db.run(sql`DROP TABLE \`_tales_v_texts\`;`)
  await db.run(sql`DROP TABLE \`pages\`;`)
  await db.run(sql`DROP TABLE \`_pages_v\`;`)
  await db.run(sql`DROP TABLE \`routes\`;`)
  await db.run(sql`DROP TABLE \`_routes_v\`;`)
  await db.run(sql`DROP TABLE \`reels\`;`)
  await db.run(sql`DROP TABLE \`_reels_v\`;`)
  await db.run(sql`DROP TABLE \`redirects\`;`)
  await db.run(sql`DROP TABLE \`publish_requests\`;`)
  await db.run(sql`DROP TABLE \`promoted\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
}
