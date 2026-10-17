variable "state_passphrase" {
  description = "解密 live 的 state（bootstrap 的 random_password.live_state_passphrase）"
  type        = string
  sensitive   = true
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

variable "owner_email" {
  description = "唯一能登入後台的人（Access 的 owner policy）"
  type        = string
  default     = "xudong.wu@gmail.com"
}

variable "github_owner" {
  type    = string
  default = "jackywxd"
}

variable "github_repository" {
  type    = string
  default = "jackywu.ca"
}

variable "infra_app_id" {
  type = string
}

variable "infra_app_installation_id" {
  type = string
}

variable "infra_app_private_key" {
  description = "hongchen-infra 的私鑰內容，必須是 PKCS#1（GitHub provider 的 app_auth 只吃這種）。secret 存的是 PKCS#8，CI 在記憶體裡用 openssl rsa -traditional 轉"
  type        = string
  sensitive   = true
  validation {
    condition     = startswith(trimspace(var.infra_app_private_key), "-----BEGIN RSA PRIVATE KEY-----")
    error_message = "hongchen-infra 的私鑰必須是 PKCS#1（BEGIN RSA PRIVATE KEY）：GitHub provider 不吃 PKCS#8。轉換：openssl rsa -traditional -in <PKCS#8 檔>"
  }
}

variable "publish_app_id" {
  type = string
}

variable "publish_app_installation_id" {
  type = string
}

variable "publish_app_private_key" {
  description = "hongchen-publish 的私鑰內容（PKCS#8）。寫進正式後台的 GITHUB_APP_PRIVATE_KEY"
  type        = string
  sensitive   = true
  validation {
    condition     = startswith(trimspace(replace(var.publish_app_private_key, "\\n", "\n")), "-----BEGIN PRIVATE KEY-----")
    error_message = "私鑰必須是 PKCS#8（BEGIN PRIVATE KEY），後台的 importPKCS8 不吃 PKCS#1。"
  }
}

variable "rotate" {
  description = "輪替：改掉某一項的值（例如改成日期），下一次 apply 就換新。鍵見 secrets.tf 與 access.tf"
  type        = map(string)
  default     = {}
}
