import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`tales\` ADD \`client_key\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`tales_client_key_idx\` ON \`tales\` (\`client_key\`);`)
  await db.run(sql`ALTER TABLE \`_tales_v\` ADD \`version_client_key\` text;`)
  await db.run(sql`CREATE INDEX \`_tales_v_version_version_client_key_idx\` ON \`_tales_v\` (\`version_client_key\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`tales_client_key_idx\`;`)
  await db.run(sql`ALTER TABLE \`tales\` DROP COLUMN \`client_key\`;`)
  await db.run(sql`DROP INDEX \`_tales_v_version_version_client_key_idx\`;`)
  await db.run(sql`ALTER TABLE \`_tales_v\` DROP COLUMN \`version_client_key\`;`)
}
