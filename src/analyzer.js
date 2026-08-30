import fs from "node:fs";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([
  ".tf", ".tfvars", ".yaml", ".yml", ".json",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".go"
]);

const IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "build", ".next",
  "coverage", ".terraform", ".venv", "venv"
]);

export function analyzeRepository(root) {
  const files = collectFiles(root);
  const issues = [];

  for (const file of files) {
    issues.push(...analyzeFile(root, file));
  }

  const totalSavings = issues.reduce(
    (sum, issue) => sum + (issue.estimatedMonthlySavings || 0),
    0
  );

  return {
    scannedFiles: files.length,
    issues: deduplicateIssues(issues),
    totalSavings
  };
}

function collectFiles(root) {
  const output = [];

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) output.push(fullPath);
    }
  }

  walk(root);
  return output;
}

function analyzeFile(root, filePath) {
  let code;

  try {
    code = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const relativeFile = normalize(path.relative(root, filePath));
  const lines = code.split(/\r?\n/);
  const issues = [];

  addPatternIssue(
    issues, relativeFile, lines,
    /(?:instance_type|instance_type_name)\s*=\s*["'](?:t3\.(?:xlarge|2xlarge)|m5\.(?:2xlarge|4xlarge)|r5\.(?:2xlarge|4xlarge))["']/i,
    {
      id: "compute-large-instance",
      category: "Compute",
      severity: "high",
      title: "Potentially oversized compute instance",
      problem: "A relatively large EC2 instance type is configured in infrastructure code.",
      recommendation: "Review CPU and memory utilization and right-size the instance or use autoscaling where appropriate.",
      impact: "Potentially significant compute savings.",
      estimatedMonthlySavings: 70
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /instance_class\s*=\s*["']db\.(?:r5|r6i)\.(?:2xlarge|4xlarge)["']/i,
    {
      id: "rds-large-instance",
      category: "Database",
      severity: "high",
      title: "Potentially oversized RDS instance",
      problem: "A large RDS instance class is configured.",
      recommendation: "Check database CPU, memory, connections and IOPS before choosing a smaller instance.",
      impact: "Potentially hundreds of dollars per month depending on region and workload.",
      estimatedMonthlySavings: 300
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /backup_retention_period\s*=\s*(?:30|31|32|33|34|35|36|37|38|39|40|41|42|43|44|45|46|47|48|49|50|51|52|53|54|55|56|57|58|59|60)\b/i,
    {
      id: "rds-backup-retention",
      category: "Database",
      severity: "medium",
      title: "Long RDS backup retention",
      problem: "RDS backup retention is configured for 30+ days.",
      recommendation: "Review the required recovery window and reduce retention when business requirements allow.",
      impact: "Can reduce backup storage costs.",
      estimatedMonthlySavings: 50
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /resource\s+"aws_s3_bucket"/i,
    {
      id: "s3-lifecycle",
      category: "Storage",
      severity: "medium",
      title: "S3 lifecycle policy may be missing",
      problem: "An S3 bucket is defined, but no lifecycle rule was found in the same file.",
      recommendation: "Use lifecycle transitions or Intelligent-Tiering for objects whose access patterns change over time.",
      impact: "Can reduce storage cost for older objects.",
      estimatedMonthlySavings: 100
    },
    code => !/lifecycle_rule|aws_s3_bucket_lifecycle_configuration/i.test(code)
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /(?:volume_size|size)\s*=\s*1000\b/i,
    {
      id: "ebs-large-volume",
      category: "Storage",
      severity: "high",
      title: "Large block storage volume",
      problem: "A 1000 GB storage allocation was found.",
      recommendation: "Compare provisioned capacity with actual usage and right-size or enable appropriate scaling.",
      impact: "Potential storage savings.",
      estimatedMonthlySavings: 60
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /memory_size\s*=\s*(?:2048|3008|4096)\b/i,
    {
      id: "lambda-memory",
      category: "Lambda",
      severity: "medium",
      title: "High Lambda memory allocation",
      problem: "Lambda memory is configured at 2 GB or more.",
      recommendation: "Benchmark execution time at lower memory settings. Lambda pricing depends on memory and duration.",
      impact: "Potential Lambda compute savings.",
      estimatedMonthlySavings: 50
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /resource\s+"aws_cloudwatch_log_group"/i,
    {
      id: "cloudwatch-retention",
      category: "Logging",
      severity: "medium",
      title: "CloudWatch retention policy may be missing",
      problem: "A CloudWatch log group is defined without an obvious retention setting in the same file.",
      recommendation: "Set retention_in_days according to operational and compliance requirements.",
      impact: "Can reduce long-term log storage costs.",
      estimatedMonthlySavings: 50
    },
    code => !/retention_in_days\s*=/i.test(code)
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /(?:log_level|LOG_LEVEL)\s*[:=]\s*["']debug["']/i,
    {
      id: "debug-logging",
      category: "Logging",
      severity: "medium",
      title: "Debug logging enabled",
      problem: "Debug-level logging appears to be enabled.",
      recommendation: "Use INFO/WARN in production unless DEBUG is required for a controlled diagnostic period.",
      impact: "Reducing unnecessary log ingestion can lower monitoring costs.",
      estimatedMonthlySavings: 30
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /node_type\s*=\s*["']cache\.(?:t2\.micro|t2\.small)["']/i,
    {
      id: "elasticache-node",
      category: "Cache",
      severity: "low",
      title: "Legacy/small ElastiCache node detected",
      problem: "A small cache node type was found.",
      recommendation: "Validate current utilization and compare available node families and pricing before changing it.",
      impact: "Performance/cost should be validated using actual cache metrics.",
      estimatedMonthlySavings: 0
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /resource\s+"aws_eip"/i,
    {
      id: "elastic-ip",
      category: "Miscellaneous",
      severity: "low",
      title: "Elastic IP resource detected",
      problem: "An Elastic IP is declared; unattached addresses can create unnecessary charges.",
      recommendation: "Verify that every Elastic IP is attached and required.",
      impact: "Small savings per unused address.",
      estimatedMonthlySavings: 4
    }
  );

  addPatternIssue(
    issues, relativeFile, lines,
    /(?:region\s*=\s*["'][^"']+["'])/i,
    {
      id: "multi-region-review",
      category: "Data Transfer",
      severity: "low",
      title: "Cloud region configuration detected",
      problem: "A cloud region is explicitly configured.",
      recommendation: "If the repository uses multiple regions, review cross-region traffic and replication costs.",
      impact: "Cross-region data transfer can increase network spend.",
      estimatedMonthlySavings: 0
    },
    code => countMatches(code, /\bregion\s*=\s*["'][^"']+["']/gi) > 1
  );

  addApplicationCachingHint(issues, relativeFile, lines, code);

  return issues;
}

function addApplicationCachingHint(issues, file, lines, code) {
  const hasDatabaseCall = /(?:\.query\(|\.find\(|\.findOne\(|SELECT\s+.+\s+FROM|axios\.(?:get|post)\(|fetch\()/i.test(code);
  const hasCache = /redis|ioredis|cache-manager|node-cache|memcached|elasticache/i.test(code);

  if (hasDatabaseCall && !hasCache && /[.]js$|[.]ts$|[.]jsx$|[.]tsx$|[.]py$/.test(file)) {
    const line = findLine(lines, /(?:\.query\(|\.find\(|\.findOne\(|SELECT\s+.+\s+FROM|axios\.(?:get|post)\(|fetch\()/i);

    issues.push({
      id: "application-caching",
      category: "Data Transfer",
      severity: "low",
      title: "Repeated data-access path without an obvious cache",
      problem: "A database/API access pattern was found without an obvious caching library in the file.",
      recommendation: "Only add caching for genuinely repeated, cacheable workloads after measuring request volume and cache hit rate.",
      impact: "Caching can reduce database load and network/API usage, but should be validated before implementation.",
      estimatedMonthlySavings: 0,
      file,
      line
    });
  }
}

function addPatternIssue(issues, file, lines, regex, template, condition = () => true) {
  const code = lines.join("\n");
  const match = regex.exec(code);

  if (!match || !condition(code)) return;

  const line = findLine(lines, regex);

  issues.push({
    ...template,
    file,
    line
  });
}

function findLine(lines, regex) {
  for (let i = 0; i < lines.length; i++) {
    regex.lastIndex = 0;
    if (regex.test(lines[i])) return i + 1;
  }
  return 1;
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function deduplicateIssues(issues) {
  const seen = new Set();
  return issues.filter(issue => {
    const key = `${issue.id}:${issue.file}:${issue.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value) {
  return value.split(path.sep).join("/");
}
