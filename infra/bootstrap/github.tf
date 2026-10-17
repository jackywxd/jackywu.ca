data "github_user" "owner" {
  username = var.github_owner
}

locals {
  repo = var.github_repository
}

# infra-apply 的 apply job：要你核准，只允許 main
resource "github_repository_environment" "infra" {
  repository  = local.repo
  environment = "infra"
  reviewers {
    users = [tonumber(data.github_user.owner.id)]
  }
  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
  lifecycle { prevent_destroy = true }
}

resource "github_repository_environment_deployment_policy" "infra_main" {
  repository     = local.repo
  environment    = github_repository_environment.infra.environment
  branch_pattern = "main"
}

# infra-plan：PR 上的 plan 與 infra-apply 的 plan job。不需要核准（只讀），但只有同 repo 的 PR 會用到它
resource "github_repository_environment" "infra_plan" {
  repository  = local.repo
  environment = "infra-plan"
  lifecycle { prevent_destroy = true }
}

# admin-deploy.yml 的兩個目標。名稱不分大小寫：既有的「Production」就是 production，必須用原本的大小寫匯入
resource "github_repository_environment" "staging" {
  repository  = local.repo
  environment = "staging"
  lifecycle { prevent_destroy = true }
}

resource "github_repository_environment" "production" {
  repository  = local.repo
  environment = "Production"
  reviewers {
    users = [tonumber(data.github_user.owner.id)]
  }
  lifecycle { prevent_destroy = true }
}

locals {
  state_key_id = cloudflare_account_token.state.id
  state_secret = sha256(cloudflare_account_token.state.value)

  # 兩個 infra environment 都要的：讀寫 state、解密 state、GitHub App（provider 用）、發佈 App 的私鑰（live 要配送它）
  infra_common = {
    TF_STATE_ACCESS_KEY_ID     = local.state_key_id
    TF_STATE_SECRET_ACCESS_KEY = local.state_secret
    TF_STATE_PASSPHRASE        = random_password.live_state_passphrase.result
    INFRA_APP_PRIVATE_KEY      = file(var.infra_app_private_key_file)
    PUBLISH_APP_PRIVATE_KEY    = file(var.publish_app_private_key_file)
  }
}

resource "github_actions_environment_secret" "infra" {
  for_each    = merge(local.infra_common, { CLOUDFLARE_API_TOKEN = cloudflare_account_token.ci_apply.value })
  repository  = local.repo
  environment = github_repository_environment.infra.environment
  secret_name = each.key
  value       = each.value
}

resource "github_actions_environment_secret" "infra_plan" {
  for_each    = merge(local.infra_common, { CLOUDFLARE_API_TOKEN = cloudflare_account_token.ci_plan.value })
  repository  = local.repo
  environment = github_repository_environment.infra_plan.environment
  secret_name = each.key
  value       = each.value
}

# publish.yml 用的 R2 憑證（取代手動建的那兩組；舊 token 由你在 dashboard 撤銷）
resource "github_actions_secret" "r2" {
  for_each = {
    R2_PRIVATE_KEY_ID = cloudflare_account_token.r2_private_read.id
    R2_PRIVATE_SECRET = sha256(cloudflare_account_token.r2_private_read.value)
    R2_PUBLIC_KEY_ID  = cloudflare_account_token.r2_public_rw.id
    R2_PUBLIC_SECRET  = sha256(cloudflare_account_token.r2_public_rw.value)
  }
  repository  = local.repo
  secret_name = each.key
  value       = each.value
}
