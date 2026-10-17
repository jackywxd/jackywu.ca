# publish.yml／backup.yml／admin-deploy.yml 用的 repo secrets。R2 的那四個由 bootstrap 管（它們是 token）。
# 用 gh secret set 手動改這些值會在下一次 apply 被改回來：要改就改這裡。
resource "github_actions_secret" "this" {
  for_each = {
    CF_ACCESS_CLIENT_ID     = cloudflare_zero_trust_access_service_token.this["ci"].client_id
    CF_ACCESS_CLIENT_SECRET = cloudflare_zero_trust_access_service_token.this["ci"].client_secret
    PUBLISH_HMAC_SECRET     = local.secret["prod.PUBLISH_HMAC_SECRET"]
  }
  repository  = var.github_repository
  secret_name = each.key
  value       = each.value
}
