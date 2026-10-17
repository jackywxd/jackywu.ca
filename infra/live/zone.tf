# jackywu.ca 的 zone 設定。
# DNS：目前只有 Cloudflare 自己管的記錄（Worker 與 R2 custom domain 自動建立、唯讀），沒有要交給 tofu 的；
# 之後新增記錄就寫在這裡。**絕不 import 唯讀的那幾筆**，它們由 wrangler 與 R2 管。

# www → apex 的 301（dashboard 範本建的，imports.tf 接手）
resource "cloudflare_ruleset" "redirect" {
  zone_id = var.zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"
  rules = [{
    description = "Redirect from WWW to root [Template]"
    expression  = "(http.host eq \"www.jackywu.ca\")"
    action      = "redirect"
    enabled     = true
    action_parameters = {
      from_value = {
        preserve_query_string = true
        status_code           = 301
        target_url            = { expression = "wildcard_replace(http.request.full_uri, \"https://www.*\", \"https://$${1}\")" }
      }
    }
  }]
  lifecycle { prevent_destroy = true }
}

# 現值照快照寫下來，之後要改就在這裡改（例如把 min_tls_version 提高）
locals {
  zone_settings = {
    ssl              = "full"
    always_use_https = "on"
    min_tls_version  = "1.0"
  }
}

resource "cloudflare_zone_setting" "this" {
  for_each   = local.zone_settings
  zone_id    = var.zone_id
  setting_id = each.key
  value      = each.value
}
