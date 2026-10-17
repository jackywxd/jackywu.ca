# 每次 plan 都會評估（包括每週的漂移檢查）：只警告，不擋 apply
check "service_tokens_not_expiring" {
  assert {
    condition = alltrue([for t in cloudflare_zero_trust_access_service_token.this :
      t.expires_at == null || timecmp(t.expires_at, timeadd(plantimestamp(), "720h")) > 0
    ])
    error_message = "有 service token 會在 30 天內到期：設 var.rotate[\"service_token.<名稱>\"] = \"<下一版>|<舊密鑰失效時間>\" 換新（docs/infra.md 的輪替）。"
  }
}

check "team_domain_format" {
  assert {
    # 後台的 access-jwt.ts 只接受這個格式
    condition     = can(regex("^https://[^/]+$", local.team_domain))
    error_message = "ACCESS_TEAM_DOMAIN 必須是 https://<team>.cloudflareaccess.com"
  }
}
