# bootstrap：核發憑證與守住 CI 的閘門。只由你在本機 apply（見 docs/infra.md 的 M1），CI 永遠不碰這個 stack，
# 所以 CI 的 token 不需要、也沒有「核發 token」的權限。
terraform {
  required_version = "~> 1.13.0"

  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.28.0" }
    github     = { source = "integrations/github", version = "~> 6.13.0" }
    random     = { source = "hashicorp/random", version = "~> 3.7" }
  }

  # state 與 plan 都在用戶端加密：裡面有每一把 token 的明文
  encryption {
    key_provider "pbkdf2" "bootstrap" {
      passphrase = var.bootstrap_passphrase
    }
    method "aes_gcm" "bootstrap" {
      keys = key_provider.pbkdf2.bootstrap
    }
    state {
      method   = method.aes_gcm.bootstrap
      enforced = true
    }
    plan {
      method   = method.aes_gcm.bootstrap
      enforced = true
    }
  }
}

provider "cloudflare" {
  # 讀 CLOUDFLARE_API_TOKEN：一把只用一天、由你在 dashboard 建的 bootstrap token
}

provider "github" {
  owner = var.github_owner
  # 讀 GITHUB_TOKEN：你本機 gh 的登入（export GITHUB_TOKEN=$(gh auth token)）
}
