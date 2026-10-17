# state 放在這個 stack 自己建的 bucket。第一次 apply 時 bucket 還不存在：
# 照 docs/infra.md 的 M1，先把這個檔案改名成 backend.tf.off 用本機 state apply，再改回來並 tofu init -migrate-state。
terraform {
  backend "s3" {
    bucket = "hongchen-tofu-state"
    key    = "bootstrap/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://e92ee6e81173e12edb023ed5ee34faee.r2.cloudflarestorage.com"
    }
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}
