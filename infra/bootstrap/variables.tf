variable "bootstrap_passphrase" {
  description = "加密這個 stack 的 state 與 plan。至少 16 字元；存在你的密碼管理器，遺失就讀不回 state"
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.bootstrap_passphrase) >= 16
    error_message = "密語至少 16 個字元。"
  }
}

variable "account_id" {
  type    = string
  default = "e92ee6e81173e12edb023ed5ee34faee"
}

variable "zone_id" {
  description = "jackywu.ca（infra/discovery/snapshot.json）"
  type        = string
  default     = "f4cb623bddcc3b51acdfdfd599222bce"
}

variable "github_owner" {
  type    = string
  default = "jackywxd"
}

variable "github_repository" {
  type    = string
  default = "jackywu.ca"
}

variable "infra_app_private_key_file" {
  description = "GitHub App hongchen-infra 的私鑰（PKCS#8，openssl pkcs8 -topk8 -nocrypt 轉過）的本機路徑"
  type        = string
  validation {
    condition     = startswith(trimspace(file(var.infra_app_private_key_file)), "-----BEGIN PRIVATE KEY-----")
    error_message = "私鑰必須是 PKCS#8（BEGIN PRIVATE KEY）。GitHub 給的是 PKCS#1，先轉：openssl pkcs8 -topk8 -nocrypt -in 下載的.pem -out 轉好的.pem"
  }
}

variable "publish_app_private_key_file" {
  description = "發佈用 GitHub App 的私鑰（PKCS#8）的本機路徑"
  type        = string
  validation {
    condition     = startswith(trimspace(file(var.publish_app_private_key_file)), "-----BEGIN PRIVATE KEY-----")
    error_message = "私鑰必須是 PKCS#8（BEGIN PRIVATE KEY）。GitHub 給的是 PKCS#1，先轉：openssl pkcs8 -topk8 -nocrypt -in 下載的.pem -out 轉好的.pem"
  }
}

variable "rotate" {
  description = "輪替：把某一項的值改掉（例如改成日期），下一次 apply 就會換新的那把 token 或密語"
  type        = map(string)
  default     = {}
}
