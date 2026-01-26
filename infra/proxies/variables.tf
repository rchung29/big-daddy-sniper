variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_id" {
  description = "VPC ID where proxies will be created"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID for proxy instances (use same subnet as your bot for lowest latency)"
  type        = string
}

variable "proxy_count" {
  description = "Number of proxy instances to create"
  type        = number
  default     = 3
}

variable "instance_type" {
  description = "EC2 instance type (t3.nano is sufficient for proxying)"
  type        = string
  default     = "t3.nano"
}

variable "key_name" {
  description = "SSH key pair name for debugging access"
  type        = string
  default     = null
}

variable "allowed_security_groups" {
  description = "Security group IDs allowed to access the proxy"
  type        = list(string)
  default     = []
}

variable "allowed_cidrs" {
  description = "CIDR blocks allowed to access the proxy"
  type        = list(string)
  default     = ["10.0.0.0/8"]
}

variable "ssh_cidrs" {
  description = "CIDR blocks allowed SSH access (for debugging)"
  type        = list(string)
  default     = []
}
