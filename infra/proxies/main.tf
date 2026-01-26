terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Get the latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Security group for proxy instances
resource "aws_security_group" "proxy" {
  name        = "resy-proxy-sg"
  description = "Security group for Resy proxy instances"
  vpc_id      = var.vpc_id

  # Allow proxy traffic from your bot's security group or CIDR
  ingress {
    from_port       = 8888
    to_port         = 8888
    protocol        = "tcp"
    security_groups = var.allowed_security_groups
    cidr_blocks     = var.allowed_cidrs
  }

  # Allow SSH for debugging (optional)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_cidrs
  }

  # Allow all outbound (for proxying to Resy API)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "resy-proxy-sg"
  }
}

# Proxy EC2 instances
resource "aws_instance" "proxy" {
  count = var.proxy_count

  ami           = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id
  key_name      = var.key_name

  vpc_security_group_ids = [aws_security_group.proxy.id]

  user_data = <<-EOF
    #!/bin/bash
    set -e

    # Install tinyproxy
    dnf install -y tinyproxy

    # Configure tinyproxy
    cat > /etc/tinyproxy/tinyproxy.conf << 'CONF'
    User tinyproxy
    Group tinyproxy
    Port 8888
    Timeout 600
    DefaultErrorFile "/usr/share/tinyproxy/default.html"
    StatFile "/usr/share/tinyproxy/stats.html"
    LogFile "/var/log/tinyproxy/tinyproxy.log"
    LogLevel Info
    MaxClients 100
    Allow 10.0.0.0/8
    Allow 172.16.0.0/12
    Allow 192.168.0.0/16
    ${join("\n", [for cidr in var.allowed_cidrs : "Allow ${cidr}"])}
    ViaProxyName "tinyproxy"
    ConnectPort 443
    ConnectPort 80
    CONF

    # Enable and start tinyproxy
    systemctl enable tinyproxy
    systemctl start tinyproxy

    # Log completion
    echo "Proxy setup complete" >> /var/log/user-data.log
  EOF

  tags = {
    Name = "resy-proxy-${count.index + 1}"
  }
}
