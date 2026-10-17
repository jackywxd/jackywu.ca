# 給本機用（例如緊急時在本機對 live 跑 plan）。全部是 sensitive：用 tofu output -raw 直接接進變數，不要印出來
output "state_access_key_id" {
  value = local.state_key_id
}

output "state_secret_access_key" {
  value     = local.state_secret
  sensitive = true
}

output "live_state_passphrase" {
  value     = random_password.live_state_passphrase.result
  sensitive = true
}
