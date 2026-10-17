# 非機密：寫進文件或拿來核對用
output "access_aud" {
  value = { for k, a in cloudflare_zero_trust_access_application.this : k => a.aud }
}

output "access_team_domain" {
  value = local.team_domain
}

output "ci_client_id" {
  description = "hongchen-ci 的 client id（不是機密；Payload 只把這一組當 reader）"
  value       = cloudflare_zero_trust_access_service_token.this["ci"].client_id
}
