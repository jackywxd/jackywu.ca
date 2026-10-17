# 以 mock provider 驗證 live 的配送規則（random 用真的：它只在本機算亂數）。
# 防的失敗：某個 Worker 拿到另一個環境的值、排程與後台的 SWEEP 不一致而看門狗永遠驗不過、
# staging 拿到發佈用的金鑰、或機器的 Service Auth 被掛到前台 staging 上。

mock_provider "cloudflare" {
  mock_data "cloudflare_zero_trust_organization" {
    defaults = { auth_domain = "allconnect.cloudflareaccess.com" }
  }
  mock_resource "cloudflare_zero_trust_access_service_token" {
    defaults = { client_id = "mock-client-id.access", client_secret = "mock-client-secret", expires_at = "2099-01-01T00:00:00Z" }
  }
  mock_resource "cloudflare_zero_trust_access_application" {
    defaults = { aud = "mock-aud" }
  }
  mock_resource "cloudflare_zero_trust_access_policy" {
    defaults = { id = "mock-policy" }
  }
}

mock_provider "github" {}

variables {
  state_passphrase            = "test-passphrase-at-least-16"
  infra_app_id                = "1"
  infra_app_installation_id   = "2"
  infra_app_private_key       = "-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----"
  publish_app_id              = "5354140"
  publish_app_installation_id = "172289186"
  publish_app_private_key     = "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----"
}

run "worker_secrets_routing" {
  command = apply

  assert {
    condition     = nonsensitive(local.worker_secrets["hongchen-admin"].PAYLOAD_SECRET != local.worker_secrets["hongchen-admin-staging"].PAYLOAD_SECRET)
    error_message = "正式與 staging 不能共用 PAYLOAD_SECRET"
  }
  assert {
    condition     = nonsensitive(local.worker_secrets["hongchen-admin-cron"].SWEEP_HMAC_SECRET == local.worker_secrets["hongchen-admin"].SWEEP_HMAC_SECRET)
    error_message = "正式排程與正式後台的 SWEEP 必須相同，否則看門狗的簽章永遠驗不過"
  }
  assert {
    condition     = nonsensitive(local.worker_secrets["hongchen-admin-cron-staging"].SWEEP_HMAC_SECRET == local.worker_secrets["hongchen-admin-staging"].SWEEP_HMAC_SECRET)
    error_message = "staging 排程與 staging 後台的 SWEEP 必須相同"
  }
  assert {
    condition     = nonsensitive(github_actions_secret.this["PUBLISH_HMAC_SECRET"].value == local.worker_secrets["hongchen-admin"].PUBLISH_HMAC_SECRET)
    error_message = "GitHub 與後台的 PUBLISH_HMAC_SECRET 必須相同，否則發佈的回呼一律 401"
  }
  assert {
    condition     = length(setintersection(keys(local.worker_secrets["hongchen-admin-staging"]), ["PUBLISH_HMAC_SECRET", "GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY"])) == 0
    error_message = "staging 沒有發佈流程，不能拿到發佈的金鑰"
  }
  assert {
    condition     = local.worker_secrets["hongchen-admin"].ACCESS_TEAM_DOMAIN == "https://allconnect.cloudflareaccess.com"
    error_message = "team domain 的格式要和 access-jwt.ts 一致"
  }
  assert {
    condition     = alltrue([for w, s in local.worker_secrets : alltrue([for k, v in s : nonsensitive(v != "")])])
    error_message = "不能有空的 secret"
  }
}

run "service_auth_only_on_admin_apps" {
  command = apply

  assert {
    condition     = length(cloudflare_zero_trust_access_application.this["admin"].policies) == 2 && length(cloudflare_zero_trust_access_application.this["admin_staging"].policies) == 2
    error_message = "兩個後台都要有 owner 與 Service Auth"
  }
  assert {
    condition     = length(cloudflare_zero_trust_access_application.this["site_staging"].policies) == 1
    error_message = "前台 staging 只給 owner，不放行機器"
  }
  assert {
    condition     = cloudflare_zero_trust_access_policy.service.decision == "non_identity"
    error_message = "機器用的 policy 必須是 Service Auth（non_identity）"
  }
}

run "rejects_pkcs1_key" {
  command = plan
  variables {
    publish_app_private_key = "-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----"
  }
  expect_failures = [var.publish_app_private_key]
}

run "rejects_pkcs8_infra_key" {
  command = plan
  variables {
    infra_app_private_key = "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----"
  }
  expect_failures = [var.infra_app_private_key]
}
