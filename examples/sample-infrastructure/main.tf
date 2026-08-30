provider "aws" {
  region = "us-east-1"
}

resource "aws_instance" "app" {
  instance_type = "t3.xlarge"
}

resource "aws_db_instance" "main" {
  instance_class         = "db.r5.4xlarge"
  backup_retention_period = 30
}

resource "aws_s3_bucket" "assets" {
  bucket = "example-assets"
}

resource "aws_ebs_volume" "data" {
  availability_zone = "us-east-1a"
  size              = 1000
}

resource "aws_cloudwatch_log_group" "app" {
  name = "/app/example"
}

resource "aws_lambda_function" "worker" {
  function_name = "worker"
  memory_size   = 2048
}

resource "aws_eip" "unused" {
  domain = "vpc"
}
