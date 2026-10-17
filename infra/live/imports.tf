# M0 手動建的資源（id 來自 infra/discovery/snapshot.json）。第一次 apply 之後這些區塊就沒有作用了，留著當紀錄。
# lifecycle 規則、r2.dev 設定、zone 設定不支援 import：它們以「建立」的方式寫入同樣的值（見 r2.tf、zone.tf）。

import {
  to = cloudflare_d1_database.admin
  id = "e92ee6e81173e12edb023ed5ee34faee/3b014573-73d8-4778-bd14-ce20e198f1c7"
}

import {
  to = cloudflare_d1_database.admin_staging
  id = "e92ee6e81173e12edb023ed5ee34faee/e19b49b0-eac7-4f62-a03b-2e8759c08bed"
}

import {
  to = cloudflare_r2_bucket.this["private"]
  id = "e92ee6e81173e12edb023ed5ee34faee/hongchen-admin-private/default"
}

import {
  to = cloudflare_r2_bucket.this["private_staging"]
  id = "e92ee6e81173e12edb023ed5ee34faee/hongchen-admin-private-staging/default"
}

import {
  to = cloudflare_r2_bucket.this["media"]
  id = "e92ee6e81173e12edb023ed5ee34faee/zhuiyunzhuxue-media/default"
}

import {
  to = cloudflare_zero_trust_access_identity_provider.otp
  id = "accounts/e92ee6e81173e12edb023ed5ee34faee/931243d8-fe37-4b77-b421-77f0ff7e9faf"
}

import {
  to = cloudflare_zero_trust_access_policy.owner
  id = "e92ee6e81173e12edb023ed5ee34faee/9910e69b-db7c-4dbe-84c8-a118c94a3f8d"
}

import {
  to = cloudflare_zero_trust_access_application.this["admin"]
  id = "accounts/e92ee6e81173e12edb023ed5ee34faee/0ead07ec-6560-4531-8b8d-e3a7f7b8bd2b"
}

import {
  to = cloudflare_zero_trust_access_application.this["admin_staging"]
  id = "accounts/e92ee6e81173e12edb023ed5ee34faee/7f797821-0da4-422d-a250-c30ee8486a65"
}

import {
  to = cloudflare_zero_trust_access_application.this["site_staging"]
  id = "accounts/e92ee6e81173e12edb023ed5ee34faee/d6e1ca4d-6a27-4a71-8613-b01bfd749b2d"
}

import {
  to = cloudflare_ruleset.redirect
  id = "zones/f4cb623bddcc3b51acdfdfd599222bce/153ec484100c4efaa4587a5860750ed1"
}
