import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`routes\` ADD \`moving_time\` text;`)
  await db.run(sql`ALTER TABLE \`routes\` ADD \`started_at\` text;`)
  await db.run(sql`ALTER TABLE \`_routes_v\` ADD \`version_moving_time\` text;`)
  await db.run(sql`ALTER TABLE \`_routes_v\` ADD \`version_started_at\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`routes\` DROP COLUMN \`moving_time\`;`)
  await db.run(sql`ALTER TABLE \`routes\` DROP COLUMN \`started_at\`;`)
  await db.run(sql`ALTER TABLE \`_routes_v\` DROP COLUMN \`version_moving_time\`;`)
  await db.run(sql`ALTER TABLE \`_routes_v\` DROP COLUMN \`version_started_at\`;`)
}
