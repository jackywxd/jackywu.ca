# 兩個 stack 的 state（都已在用戶端加密）、apply 前的備份、Worker secret 同步的指紋檔
resource "cloudflare_r2_bucket" "tofu_state" {
  account_id = var.account_id
  name       = "hongchen-tofu-state"
  location   = "WNAM"

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [location, jurisdiction, storage_class]
  }
}

resource "cloudflare_r2_managed_domain" "tofu_state" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.tofu_state.name
  enabled     = false
}

resource "cloudflare_r2_bucket_lifecycle" "tofu_state" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.tofu_state.name
  rules = [
    {
      # R2 新 bucket 的預設規則；寫進來，否則 apply 會把它刪掉
      id                                 = "Default Multipart Abort Rule"
      enabled                            = true
      conditions                         = { prefix = "" }
      abort_multipart_uploads_transition = { condition = { type = "Age", max_age = 604800 } }
    },
    {
      # infra-apply 每次 plan 前把加密的 state 複製到 backups/（R2 沒有版本控制）
      id                        = "expire-backups-90d"
      enabled                   = true
      conditions                = { prefix = "backups/" }
      delete_objects_transition = { condition = { type = "Age", max_age = 7776000 } }
    },
  ]
}
