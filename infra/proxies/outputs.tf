output "proxy_private_ips" {
  description = "Private IPs of proxy instances"
  value       = aws_instance.proxy[*].private_ip
}

output "proxy_urls" {
  description = "Proxy URLs for database insertion"
  value       = [for ip in aws_instance.proxy[*].private_ip : "http://${ip}:8888"]
}

output "proxy_instance_ids" {
  description = "Instance IDs for management"
  value       = aws_instance.proxy[*].id
}

output "sql_insert" {
  description = "SQL to insert proxies into database"
  value       = <<-EOF
    INSERT INTO proxies (url, type, enabled) VALUES
    ${join(",\n", [for ip in aws_instance.proxy[*].private_ip : "('http://${ip}:8888', 'datacenter', true)"])};
  EOF
}
