# 後台的資料庫。M0 手動建的，由 imports.tf 接手。換掉 = 資料全部消失，所以絕不允許刪除或取代；
# 建立後就不能改的欄位一律忽略，免得 plan 把它們當成要「取代」。schema 只由後台的 migrations 管（admin-deploy.yml）。
locals {
  d1 = {
    admin         = "hongchen-admin"
    admin_staging = "hongchen-admin-staging"
  }
}

resource "cloudflare_d1_database" "admin" {
  account_id = var.account_id
  name       = local.d1.admin
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [primary_location_hint, jurisdiction, read_replication]
  }
}

resource "cloudflare_d1_database" "admin_staging" {
  account_id = var.account_id
  name       = local.d1.admin_staging
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [primary_location_hint, jurisdiction, read_replication]
  }
}
