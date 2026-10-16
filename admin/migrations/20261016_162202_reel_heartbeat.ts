import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`reels\` ADD \`transcode_heartbeat_at\` numeric;`)
  await db.run(sql`ALTER TABLE \`reels\` ADD \`transcode_upload_started_at\` numeric;`)
  await db.run(sql`ALTER TABLE \`_reels_v\` ADD \`version_transcode_heartbeat_at\` numeric;`)
  await db.run(sql`ALTER TABLE \`_reels_v\` ADD \`version_transcode_upload_started_at\` numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`reels\` DROP COLUMN \`transcode_heartbeat_at\`;`)
  await db.run(sql`ALTER TABLE \`reels\` DROP COLUMN \`transcode_upload_started_at\`;`)
  await db.run(sql`ALTER TABLE \`_reels_v\` DROP COLUMN \`version_transcode_heartbeat_at\`;`)
  await db.run(sql`ALTER TABLE \`_reels_v\` DROP COLUMN \`version_transcode_upload_started_at\`;`)
}
