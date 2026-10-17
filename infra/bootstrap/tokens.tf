# 所有 Cloudflare 與 R2 的 API token 都在這裡核發。權限名稱是 API 的名稱（dashboard 上的 Edit 在 API 叫 Write）；
# 名稱查不到時 plan 直接失敗並指出是哪一個，不會靜默地少一個權限。
data "cloudflare_account_api_token_permission_groups_list" "all" {
  account_id = var.account_id
  max_items  = 2000
}

locals {
  # 同一個名稱在 account 與 zone 各有一個 id，所以用「範圍|名稱」當鍵
  permission_ids = {
    for g in data.cloudflare_account_api_token_permission_groups_list.all.result :
    "${g.scopes[0]}|${g.name}" => g.id...
  }
  pg = { for k, ids in local.permission_ids : k => ids[0] }

  account_scope = "com.cloudflare.api.account"
  zone_scope    = "com.cloudflare.api.account.zone"
  bucket_scope  = "com.cloudflare.edge.r2.bucket"

  account_resource = jsonencode({ "com.cloudflare.api.account.${var.account_id}" = "*" })
  zone_resource    = jsonencode({ "com.cloudflare.api.account.zone.${var.zone_id}" = "*" })
  bucket_resource  = { for b in ["hongchen-tofu-state", "hongchen-admin-private", "zhuiyunzhuxue-media"] : b => jsonencode({ "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${b}" = "*" }) }

  # infra/live 要管的東西。plan 用的唯讀 token 拿同一份清單的 Read 版本
  live_account_permissions = [
    "D1", "Workers R2 Storage", "Workers Scripts",
    "Access: Apps and Policies", "Access: Service Tokens", "Access: Organizations, Identity Providers, and Groups",
    "Email Routing Addresses",
  ]
  live_zone_permissions = ["DNS", "Zone Settings", "Dynamic URL Redirects", "Cache Settings", "Email Routing Rules"]

  ids = {
    ci_apply_account = [for p in local.live_account_permissions : local.pg["${local.account_scope}|${p} Write"]]
    ci_apply_zone    = concat([local.pg["${local.zone_scope}|Zone Read"]], [for p in local.live_zone_permissions : local.pg["${local.zone_scope}|${p} Write"]])
    ci_plan_account  = [for p in local.live_account_permissions : local.pg["${local.account_scope}|${p} Read"]]
    ci_plan_zone     = concat([local.pg["${local.zone_scope}|Zone Read"]], [for p in local.live_zone_permissions : local.pg["${local.zone_scope}|${p} Read"]])
    bucket_read      = local.pg["${local.bucket_scope}|Workers R2 Storage Bucket Item Read"]
    bucket_write     = local.pg["${local.bucket_scope}|Workers R2 Storage Bucket Item Write"]
  }
}

# 輪替：var.rotate 裡對應的值一改，那把 token 就換新（先建新的、寫進 GitHub，再撤舊的）
resource "terraform_data" "rotate" {
  for_each = toset(["ci_apply", "ci_plan", "state", "r2_private_read", "r2_public_rw"])
  input    = lookup(var.rotate, each.key, "initial")
}

resource "cloudflare_account_token" "ci_apply" {
  account_id = var.account_id
  name       = "hongchen-infra-ci-apply"
  policies = [
    { effect = "allow", resources = local.account_resource, permission_groups = [for id in local.ids.ci_apply_account : { id = id }] },
    { effect = "allow", resources = local.zone_resource, permission_groups = [for id in local.ids.ci_apply_zone : { id = id }] },
  ]
  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [terraform_data.rotate["ci_apply"]]
  }
}

resource "cloudflare_account_token" "ci_plan" {
  account_id = var.account_id
  name       = "hongchen-infra-ci-plan"
  policies = [
    { effect = "allow", resources = local.account_resource, permission_groups = [for id in local.ids.ci_plan_account : { id = id }] },
    { effect = "allow", resources = local.zone_resource, permission_groups = [for id in local.ids.ci_plan_zone : { id = id }] },
  ]
  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [terraform_data.rotate["ci_plan"]]
  }
}

# R2 的 S3 憑證：access key id = token id；secret = token 值的 sha256
resource "cloudflare_account_token" "state" {
  account_id = var.account_id
  name       = "hongchen-tofu-state-rw"
  policies   = [{ effect = "allow", resources = local.bucket_resource["hongchen-tofu-state"], permission_groups = [{ id = local.ids.bucket_write }] }]
  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [terraform_data.rotate["state"]]
  }
}

# publish.yml：從私有 bucket 讀原檔
resource "cloudflare_account_token" "r2_private_read" {
  account_id = var.account_id
  name       = "hongchen-publish-r2-private-read"
  policies   = [{ effect = "allow", resources = local.bucket_resource["hongchen-admin-private"], permission_groups = [{ id = local.ids.bucket_read }] }]
  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [terraform_data.rotate["r2_private_read"]]
  }
}

# publish.yml：promote 與撤回公開媒體（R2 token 最細只能限定到 bucket，不能限定前綴）
resource "cloudflare_account_token" "r2_public_rw" {
  account_id = var.account_id
  name       = "hongchen-publish-r2-public-rw"
  policies   = [{ effect = "allow", resources = local.bucket_resource["zhuiyunzhuxue-media"], permission_groups = [{ id = local.ids.bucket_write }] }]
  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [terraform_data.rotate["r2_public_rw"]]
  }
}

# 加密 infra/live 的 state。刻意不接 var.rotate：換密語要先在 live 加 fallback 才能讀舊 state（docs/infra.md 的輪替一節）
resource "random_password" "live_state_passphrase" {
  length  = 48
  special = false
}
