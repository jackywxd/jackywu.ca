# live：日常會改的基礎設施。PR 上自動 plan，合併後經 infra environment 核准才 apply（.github/workflows/infra-*.yml）。
terraform {
  required_version = "~> 1.13.0"

  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.28.0" }
    github     = { source = "integrations/github", version = "~> 6.13.0" }
    random     = { source = "hashicorp/random", version = "~> 3.7" }
  }

  # 密語由 bootstrap 產生，放在 infra／infra-plan environment 的 TF_STATE_PASSPHRASE
  encryption {
    key_provider "pbkdf2" "live" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "live" {
      keys = key_provider.pbkdf2.live
    }
    state {
      method   = method.aes_gcm.live
      enforced = true
    }
    plan {
      method   = method.aes_gcm.live
      enforced = true
    }
  }
}

provider "cloudflare" {
  # 讀 CLOUDFLARE_API_TOKEN：apply 用 hongchen-infra-ci-apply，plan 用唯讀的 hongchen-infra-ci-plan（都由 bootstrap 核發）
}

# GitHub App hongchen-infra：只有 Secrets 讀寫。不用 PAT：PAT 最長一年就過期
provider "github" {
  owner = var.github_owner
  app_auth {
    id              = var.infra_app_id
    installation_id = var.infra_app_installation_id
    pem_file        = var.infra_app_private_key
  }
}
