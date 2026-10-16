import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`publish_requests\` ADD \`late\` integer DEFAULT false;`)
  // 佇列的不變量由資料庫保證，不只靠程式：任何時刻最多一筆 dispatched；
  // 同一文件同一版本同一動作最多一筆進行中（連按兩次、兩台裝置同時按）。Payload 不知道部分索引，手寫在這裡
  await db.run(sql`CREATE UNIQUE INDEX \`publish_requests_one_dispatched\` ON \`publish_requests\` (\`status\`) WHERE \`status\` = 'dispatched';`)
  await db.run(sql`CREATE UNIQUE INDEX \`publish_requests_one_active\` ON \`publish_requests\` (\`collection_slug\`, \`doc_id\`, \`version_id\`, \`kind\`) WHERE \`status\` IN ('queued', 'dispatched');`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX IF EXISTS \`publish_requests_one_active\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`publish_requests_one_dispatched\`;`)
  await db.run(sql`ALTER TABLE \`publish_requests\` DROP COLUMN \`late\`;`)
}
