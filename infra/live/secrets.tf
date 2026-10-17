# 由程式產生的秘密。值只存在加密的 state 裡，由 GitHub provider 與同步腳本配送，沒有人看過也不需要看。
# 輪替：在 var.rotate 裡把對應的鍵改成新值（例如日期），例如 { "prod.PUBLISH_HMAC_SECRET" = "2026-12-01" }。
locals {
  generated = {
    prod    = ["PAYLOAD_SECRET", "VIDEO_INTERNAL_SECRET", "SWEEP_HMAC_SECRET", "PUBLISH_HMAC_SECRET"]
    staging = ["PAYLOAD_SECRET", "VIDEO_INTERNAL_SECRET", "SWEEP_HMAC_SECRET"]
  }
  generated_keys = toset(flatten([for env, names in local.generated : [for n in names : "${env}.${n}"]]))
}

resource "random_password" "this" {
  for_each = local.generated_keys
  # PAYLOAD_SECRET 用來簽 Payload 的 token，其他是 HMAC 金鑰；64 個英數字（約 380 bits）都夠
  length  = 64
  special = false
  keepers = { rotate = lookup(var.rotate, each.key, "initial") }
}

locals {
  secret = { for k, v in random_password.this : k => v.result }
}
