# Proxy Infrastructure

Terraform configuration for spinning up low-latency proxy servers on AWS.

## Prerequisites

- Terraform installed (`brew install terraform`)
- AWS CLI configured (`aws configure`)

## Setup

1. Get your VPC/subnet info from your existing EC2:
   ```bash
   aws ec2 describe-instances --instance-ids <your-bot-instance-id> \
     --query 'Reservations[0].Instances[0].[VpcId,SubnetId,SecurityGroups[0].GroupId]'
   ```

2. Create your tfvars:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit with your values
   ```

3. Deploy:
   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

4. After apply, Terraform outputs the SQL to insert proxies:
   ```bash
   terraform output sql_insert
   ```

   Run that SQL against your Supabase database.

5. Assign proxies to users:
   ```sql
   UPDATE users SET preferred_proxy_id = 1 WHERE discord_id = 'xxx';
   ```

## Costs

- t3.nano: ~$3/month per instance
- 3 proxies = ~$9/month

## Tear Down

```bash
terraform destroy
```
