# state 放在 bootstrap 建的 bucket（docs/infra.md 的 M1）。
terraform {
  backend "s3" {
    bucket = "hongchen-tofu-state"
    key    = "live/terraform.tfstate"
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
