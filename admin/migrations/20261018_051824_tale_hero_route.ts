import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`tales\` ADD \`hero_route\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`_tales_v\` ADD \`version_hero_route\` integer DEFAULT false;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`tales\` DROP COLUMN \`hero_route\`;`)
  await db.run(sql`ALTER TABLE \`_tales_v\` DROP COLUMN \`version_hero_route\`;`)
}
