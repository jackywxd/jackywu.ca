# 每個 Worker 的 secret 值。Cloudflare provider v5 沒有「單一 Worker secret」的資源，而 Worker 的程式碼由 wrangler 部署，
# 所以這裡只產生值，apply 之後由 scripts/infra/sync-worker-secrets.mjs 透過 Workers Secrets API 寫進去（只寫有變的）。
locals {
  matrix = { for k, v in jsondecode(file("${path.module}/../worker-secrets.json")) : k => v if !startswith(k, "$") }

  ci_token         = cloudflare_zero_trust_access_service_token.this["ci"]
  transcoder_token = cloudflare_zero_trust_access_service_token.this["transcoder"]

  worker_secrets = {
    "hongchen-admin" = {
      PAYLOAD_SECRET             = local.secret["prod.PAYLOAD_SECRET"]
      VIDEO_INTERNAL_SECRET      = local.secret["prod.VIDEO_INTERNAL_SECRET"]
      SWEEP_HMAC_SECRET          = local.secret["prod.SWEEP_HMAC_SECRET"]
      PUBLISH_HMAC_SECRET        = local.secret["prod.PUBLISH_HMAC_SECRET"]
      TRANSCODER_ACCESS_ID       = local.transcoder_token.client_id
      TRANSCODER_ACCESS_SECRET   = local.transcoder_token.client_secret
      GITHUB_APP_ID              = var.publish_app_id
      GITHUB_APP_INSTALLATION_ID = var.publish_app_installation_id
      GITHUB_APP_PRIVATE_KEY     = var.publish_app_private_key
      ACCESS_AUD                 = cloudflare_zero_trust_access_application.this["admin"].aud
      ACCESS_TEAM_DOMAIN         = local.team_domain
      ACCESS_CI_CLIENT_ID        = local.ci_token.client_id
    }
    # staging 沒有發佈流程（publish.yml 固定指向正式站），所以沒有 PUBLISH 與 GitHub App
    "hongchen-admin-staging" = {
      PAYLOAD_SECRET           = local.secret["staging.PAYLOAD_SECRET"]
      VIDEO_INTERNAL_SECRET    = local.secret["staging.VIDEO_INTERNAL_SECRET"]
      SWEEP_HMAC_SECRET        = local.secret["staging.SWEEP_HMAC_SECRET"]
      TRANSCODER_ACCESS_ID     = local.transcoder_token.client_id
      TRANSCODER_ACCESS_SECRET = local.transcoder_token.client_secret
      ACCESS_AUD               = cloudflare_zero_trust_access_application.this["admin_staging"].aud
      ACCESS_TEAM_DOMAIN       = local.team_domain
      ACCESS_CI_CLIENT_ID      = local.ci_token.client_id
    }
    # 排程只能叫看門狗：它拿的是 SWEEP，不是發佈回呼的 PUBLISH
    "hongchen-admin-cron"         = { SWEEP_HMAC_SECRET = local.secret["prod.SWEEP_HMAC_SECRET"] }
    "hongchen-admin-cron-staging" = { SWEEP_HMAC_SECRET = local.secret["staging.SWEEP_HMAC_SECRET"] }
  }
}

# 同步腳本在記憶體裡讀這個 output（tofu output -json worker_secrets），從不寫成檔案或印出來
output "worker_secrets" {
  value     = local.worker_secrets
  sensitive = true

  precondition {
    condition = alltrue([for w, names in local.matrix :
      contains(keys(local.worker_secrets), w) && toset(names) == toset(keys(local.worker_secrets[w]))
    ]) && length(local.matrix) == length(local.worker_secrets)
    error_message = "infra/worker-secrets.json 與 worker_secrets.tf 不一致：每個 Worker 的 secret 名稱必須完全相同。"
  }
}
