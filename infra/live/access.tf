# Cloudflare Access：後台唯一的入口。三個 app、owner policy、OTP 登入是 M0 手動建的（imports.tf），
# Service Auth policy 與兩組 service token 是新的。
data "cloudflare_zero_trust_organization" "this" {
  account_id = var.account_id
}

locals {
  team_domain = "https://${data.cloudflare_zero_trust_organization.this.auth_domain}"
}

resource "cloudflare_zero_trust_access_identity_provider" "otp" {
  account_id = var.account_id
  name       = ""
  type       = "onetimepin"
  config     = {}
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_zero_trust_access_policy" "owner" {
  account_id       = var.account_id
  name             = "hongchen-owner-only"
  decision         = "allow"
  include          = [{ email = { email = var.owner_email } }]
  session_duration = "168h"
  lifecycle { prevent_destroy = true }
}

# 機器的身分：GitHub Actions（拉內容、回呼）與轉碼容器（回報進度）。
# 過得了 Access 的門不等於有權限：Payload 裡只有 ACCESS_CI_CLIENT_ID 那一組是 reader，其他服務憑證是匿名
locals {
  token_rotation = { for k in ["ci", "transcoder"] : k => lookup(var.rotate, "service_token.${k}", null) }
}

resource "cloudflare_zero_trust_access_service_token" "this" {
  for_each   = toset(["ci", "transcoder"])
  account_id = var.account_id
  name       = "hongchen-${each.key}"
  duration   = "8760h"
  # 輪替：var.rotate["service_token.ci"] = "2|2026-12-02T00:00:00Z"（下一個版本號｜舊密鑰失效的時間，RFC 3339）。
  # 舊密鑰到那個時間前都還能用，進行中的 run 不會中斷；apply 之後同步腳本把新值寫進 Worker
  client_secret_version             = local.token_rotation[each.key] == null ? null : tonumber(split("|", local.token_rotation[each.key])[0])
  previous_client_secret_expires_at = local.token_rotation[each.key] == null ? null : split("|", local.token_rotation[each.key])[1]
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_zero_trust_access_policy" "service" {
  account_id = var.account_id
  name       = "hongchen-service-auth"
  decision   = "non_identity"
  include = [
    { service_token = { token_id = cloudflare_zero_trust_access_service_token.this["ci"].id } },
    { service_token = { token_id = cloudflare_zero_trust_access_service_token.this["transcoder"].id } },
  ]
  lifecycle { prevent_destroy = true }
}

locals {
  # staging.jackywu.ca 是前台的 staging，只給你看；兩個後台還要放行機器
  access_apps = {
    admin         = { name = "hongchen-admin", host = "admin.jackywu.ca", service = true }
    admin_staging = { name = "hongchen-admin-staging", host = "admin-staging.jackywu.ca", service = true }
    site_staging  = { name = "hongchen-site-staging", host = "staging.jackywu.ca", service = false }
  }
}

resource "cloudflare_zero_trust_access_application" "this" {
  for_each                   = local.access_apps
  account_id                 = var.account_id
  name                       = each.value.name
  type                       = "self_hosted"
  domain                     = each.value.host
  destinations               = [{ type = "public", uri = each.value.host }]
  session_duration           = "168h"
  allowed_idps               = [cloudflare_zero_trust_access_identity_provider.otp.id]
  auto_redirect_to_identity  = true
  app_launcher_visible       = false
  http_only_cookie_attribute = true
  policies = concat(
    [{ id = cloudflare_zero_trust_access_policy.owner.id, precedence = 1 }],
    each.value.service ? [{ id = cloudflare_zero_trust_access_policy.service.id, precedence = 2 }] : [],
  )
  lifecycle { prevent_destroy = true }
}
