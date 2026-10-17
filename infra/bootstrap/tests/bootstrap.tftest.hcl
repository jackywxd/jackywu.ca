# 以 mock provider 驗證 bootstrap 的設計約束：不連 Cloudflare 或 GitHub。
# 防的失敗：某把 token 的權限比設計的大（例如能核發 token、能碰整個帳號的 bucket），或 environment 名稱寫錯而被刪掉重建。

mock_provider "cloudflare" {
  mock_data "cloudflare_account_api_token_permission_groups_list" {
    defaults = {
      result = [
        { id = "a-d1-w", name = "D1 Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-d1-r", name = "D1 Read", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-r2-w", name = "Workers R2 Storage Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-r2-r", name = "Workers R2 Storage Read", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-ws-w", name = "Workers Scripts Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-ws-r", name = "Workers Scripts Read", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-ap-w", name = "Access: Apps and Policies Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-ap-r", name = "Access: Apps and Policies Read", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "z-ap-w", name = "Access: Apps and Policies Write", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "a-st-w", name = "Access: Service Tokens Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-st-r", name = "Access: Service Tokens Read", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-org-w", name = "Access: Organizations, Identity Providers, and Groups Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-org-r", name = "Access: Organizations, Identity Providers, and Groups Read", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-era-w", name = "Email Routing Addresses Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-era-r", name = "Email Routing Addresses Read", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "a-tok-w", name = "Account API Tokens Write", scopes = ["com.cloudflare.api.account"], category = "x", is_selectable = true },
        { id = "z-zone-r", name = "Zone Read", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-dns-w", name = "DNS Write", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-dns-r", name = "DNS Read", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-zs-w", name = "Zone Settings Write", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-zs-r", name = "Zone Settings Read", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-redir-w", name = "Dynamic URL Redirects Write", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-redir-r", name = "Dynamic URL Redirects Read", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-cache-w", name = "Cache Settings Write", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-cache-r", name = "Cache Settings Read", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-err-w", name = "Email Routing Rules Write", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "z-err-r", name = "Email Routing Rules Read", scopes = ["com.cloudflare.api.account.zone"], category = "x", is_selectable = true },
        { id = "b-item-r", name = "Workers R2 Storage Bucket Item Read", scopes = ["com.cloudflare.edge.r2.bucket"], category = "x", is_selectable = true },
        { id = "b-item-w", name = "Workers R2 Storage Bucket Item Write", scopes = ["com.cloudflare.edge.r2.bucket"], category = "x", is_selectable = true },
      ]
    }
  }
  mock_resource "cloudflare_account_token" {
    defaults = { id = "tok-id", value = "tok-value" }
  }
}

mock_provider "github" {
  mock_data "github_user" {
    defaults = { id = "4242" }
  }
}

mock_provider "random" {}

variables {
  bootstrap_passphrase         = "test-passphrase-at-least-16"
  infra_app_private_key_file   = "tests/fixtures/pkcs8.pem"
  publish_app_private_key_file = "tests/fixtures/pkcs8.pem"
}

run "r2_tokens_only_reach_one_bucket" {
  command = apply

  assert {
    condition = alltrue([for t in [cloudflare_account_token.state, cloudflare_account_token.r2_private_read, cloudflare_account_token.r2_public_rw] :
      length(t.policies) == 1 && length(keys(jsondecode(t.policies[0].resources))) == 1 &&
      startswith(keys(jsondecode(t.policies[0].resources))[0], "com.cloudflare.edge.r2.bucket.e92ee6e81173e12edb023ed5ee34faee_default_")
    ])
    error_message = "R2 token 的範圍必須剛好是一個 bucket"
  }
  assert {
    condition     = keys(jsondecode(cloudflare_account_token.r2_private_read.policies[0].resources))[0] == "com.cloudflare.edge.r2.bucket.e92ee6e81173e12edb023ed5ee34faee_default_hongchen-admin-private"
    error_message = "私有唯讀 token 指錯 bucket"
  }
  assert {
    condition     = [for g in cloudflare_account_token.r2_private_read.policies[0].permission_groups : g.id] == ["b-item-r"]
    error_message = "私有 bucket 的 token 只能讀"
  }
  assert {
    condition     = keys(jsondecode(cloudflare_account_token.r2_public_rw.policies[0].resources))[0] == "com.cloudflare.edge.r2.bucket.e92ee6e81173e12edb023ed5ee34faee_default_zhuiyunzhuxue-media"
    error_message = "公開讀寫 token 指錯 bucket"
  }
}

run "ci_tokens_cannot_mint_tokens" {
  command = apply

  assert {
    condition = !contains(flatten([for t in [cloudflare_account_token.ci_apply, cloudflare_account_token.ci_plan] :
    [for p in t.policies : [for g in p.permission_groups : g.id]]]), "a-tok-w")
    error_message = "CI 的 token 不可以有 Account API Tokens Write"
  }
  assert {
    condition = alltrue([for p in cloudflare_account_token.ci_plan.policies :
    alltrue([for g in p.permission_groups : endswith(g.id, "-r")])])
    error_message = "plan 用的 token 只能有 Read 權限"
  }
  assert {
    condition     = keys(jsondecode(cloudflare_account_token.ci_apply.policies[1].resources)) == ["com.cloudflare.api.account.zone.f4cb623bddcc3b51acdfdfd599222bce"]
    error_message = "zone 權限只能限定在 jackywu.ca"
  }
}

run "environments" {
  command = apply

  assert {
    condition     = github_repository_environment.production.environment == "Production"
    error_message = "必須是既有的「Production」（大小寫不同會被刪掉重建）"
  }
  assert {
    condition     = length(github_repository_environment.infra.reviewers[0].users) == 1 && contains(github_repository_environment.infra.reviewers[0].users, 4242)
    error_message = "infra environment 必須要你核准"
  }
  assert {
    condition     = github_actions_environment_secret.infra["CLOUDFLARE_API_TOKEN"].value == cloudflare_account_token.ci_apply.value && github_actions_environment_secret.infra_plan["CLOUDFLARE_API_TOKEN"].value == cloudflare_account_token.ci_plan.value
    error_message = "apply 用寫入 token、plan 用唯讀 token，不能對調"
  }
  assert {
    condition     = github_actions_secret.r2["R2_PRIVATE_SECRET"].value == sha256("tok-value")
    error_message = "R2 的 S3 secret 是 token 值的 sha256"
  }
}

run "rejects_pkcs1_key" {
  command = plan
  variables {
    publish_app_private_key_file = "tests/fixtures/pkcs1.pem"
  }
  expect_failures = [var.publish_app_private_key_file]
}
