# 三個 bucket 都是既有的（imports.tf）。lifecycle 與 managed domain 不支援 import：第一次 apply 會「建立」，
# 也就是用這裡的內容覆蓋線上的設定，所以這裡逐條照 infra/discovery/snapshot.json 重現，包括 R2 預設的 multipart 規則。
# media.jackywu.ca 這個 R2 custom domain 不在這裡：它不支援 import，重建會讓媒體停擺（docs/infra.md 的「不在 IaC 裡的東西」）。
locals {
  buckets = {
    private         = { name = "hongchen-admin-private", location = "ENAM" }
    private_staging = { name = "hongchen-admin-private-staging", location = "ENAM" }
    media           = { name = "zhuiyunzhuxue-media", location = "WNAM" }
  }

  day = 86400
  default_multipart_rule = {
    id                                 = "Default Multipart Abort Rule"
    enabled                            = true
    conditions                         = { prefix = "" }
    abort_multipart_uploads_transition = { condition = { type = "Age", max_age = 7 * local.day } }
  }
  # 後台私有 bucket：轉碼原檔與垃圾桶 30 天、D1 備份 12 週（backup.yml）
  private_rules = [
    local.default_multipart_rule,
    { id = "expire-backup-84d", enabled = true, conditions = { prefix = "backup/" }, delete_objects_transition = { condition = { type = "Age", max_age = 84 * local.day } } },
    { id = "expire-trash-30d", enabled = true, conditions = { prefix = "trash/" }, delete_objects_transition = { condition = { type = "Age", max_age = 30 * local.day } } },
    { id = "expire-video-src-30d", enabled = true, conditions = { prefix = "video-src/" }, delete_objects_transition = { condition = { type = "Age", max_age = 30 * local.day } } },
  ]
  lifecycle_rules = {
    private         = local.private_rules
    private_staging = local.private_rules
    media           = [local.default_multipart_rule]
  }
}

resource "cloudflare_r2_bucket" "this" {
  for_each   = local.buckets
  account_id = var.account_id
  name       = each.value.name
  location   = each.value.location
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [location, jurisdiction, storage_class]
  }
}

resource "cloudflare_r2_bucket_lifecycle" "this" {
  for_each    = local.lifecycle_rules
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.this[each.key].name
  rules       = each.value
}

# r2.dev 一律關閉：私有 bucket 不能有公開網址；公開 bucket 只走 media.jackywu.ca（快取與 CSP 都以它為準）
resource "cloudflare_r2_managed_domain" "this" {
  for_each    = local.buckets
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.this[each.key].name
  enabled     = false
}
