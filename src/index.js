import "dotenv/config";
import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "./analyzer.js";
import { analyzeWorkflows, calculateCosts } from "./analyzer/index.js";
import { optimizeGitHubCosts } from "./ai/index.js";
import { createPRComment, createPRReview, formatAIComment, formatRecommendationComment } from "./github/index.js";

function shouldAnalyzeFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const SUPPORTED_EXTENSIONS = new Set([
    ".tf", ".tfvars", ".yaml", ".yml", ".json",
    ".js", ".jsx", ".ts", ".tsx", ".py", ".go"
  ]);
  const IGNORED_FILES = new Set([
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "dist/index.cjs"
  ]);
  if (IGNORED_FILES.has(filename) || filename.includes("node_modules/") || filename.includes("dist/")) return false;
  return SUPPORTED_EXTENSIONS.has(ext);
}

async function main() {
  const isLocal = process.argv.includes("--local") || !process.env.GITHUB_ACTIONS;
  
  // Retrieve token and configuration
  let token = null;
  let failOn = "none";
  if (!isLocal) {
    token = core.getInput("github-token", { required: true });
    failOn = core.getInput("fail-on") || "none";
  } else {
    token = process.env.GITHUB_TOKEN || null;
  }

  const repoPath = process.env.GITHUB_WORKSPACE || process.cwd();
  
  console.log("🤖 GitHub AI Cost Optimizer");
  console.log(`Repository path: ${repoPath}`);

  let owner = null;
  let repo = null;
  let issueNumber = null;

  if (!isLocal && github.context) {
    owner = github.context.repo.owner;
    repo = github.context.repo.repo;
    issueNumber = github.context.issue.number;
  } else if (process.env.GITHUB_REPOSITORY) {
    const parts = process.env.GITHUB_REPOSITORY.split("/");
    owner = parts[0];
    repo = parts[1];
  }

  // 1. Analyze workflows & run statistics
  console.log("🔍 Scanning workflows...");
  const rawJobs = await analyzeWorkflows({
    repoPath,
    token,
    owner,
    repo
  });

  if (rawJobs.length === 0) {
    console.log("⚠️ No workflow files found in .github/workflows/");
  }
  // 2. Fetch changed files and diffs (from PR or local git fallback)
  let prFiles = [];
  if (token && owner && repo && issueNumber) {
    try {
      console.log(`🔍 Fetching changed files for PR #${issueNumber}...`);
      const filesResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}/files`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
          }
        }
      );
      if (filesResponse.ok) {
        const filesData = await filesResponse.json();
        for (const file of filesData) {
          if (!shouldAnalyzeFile(file.filename)) continue;
          const filePath = path.join(repoPath, file.filename);
          let content = "";
          try {
            content = await fs.readFile(filePath, "utf8");
          } catch (e) {
            console.log(`⚠️ Could not read file content for ${file.filename}:`, e.message);
          }
          prFiles.push({
            filename: file.filename,
            patch: file.patch || "",
            content
          });
        }
        console.log(`🔍 Successfully retrieved ${prFiles.length} files from PR.`);
      } else {
        const errMsg = await filesResponse.text();
        console.warn(`⚠️ Warning: Failed to fetch PR files:`, errMsg);
      }
    } catch (err) {
      console.warn("⚠️ Warning: Error fetching PR files:", err.message);
    }
  } else if (isLocal) {
    try {
      const { execSync } = await import("child_process");
      const gitFiles = execSync("git diff --name-only HEAD~1", { encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
      for (const file of gitFiles) {
        const trimmed = file.trim();
        if (!shouldAnalyzeFile(trimmed)) continue;
        const filePath = path.join(repoPath, trimmed);
        let content = "";
        let patch = "";
        try {
          content = await fs.readFile(filePath, "utf8");
          patch = execSync(`git diff HEAD~1 -- "${trimmed}"`, { encoding: "utf8" });
        } catch (e) {}
        prFiles.push({
          filename: trimmed,
          patch,
          content
        });
      }
    } catch (e) {
      // Ignore git errors
    }
  }

  // 3. Calculate execution costs
  const costAnalysis = calculateCosts(rawJobs);
  console.log(`💰 Current calculated CI/CD cost: $${costAnalysis.totalCost.toFixed(2)}`);

  let commentBody = "";
  let aiResult = null;

  // 4. AI Cost Optimization via OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    console.log("🤖 Requesting cost optimization recommendations from AI...");
    try {
      aiResult = await optimizeGitHubCosts({
        repository: process.env.GITHUB_REPOSITORY || `${owner}/${repo}` || "Unknown",
        jobs: costAnalysis.jobs,
        totalCost: costAnalysis.totalCost,
        prFiles
      });

      console.log("🤖 AI analysis completed successfully!");
      commentBody = formatAIComment(aiResult);
    } catch (err) {
      console.error("❌ Error running AI optimizer:", err.message);
      // Fallback to static reporting
    }
  } else {
    console.log("⚠️ OPENROUTER_API_KEY is not set. Skipping AI recommendation generation.");
  }

  // 4. Fallback to resource/static scanner if AI didn't run or if local
  const staticResult = analyzeRepository(repoPath);
  
  if (aiResult) {
    // Print AI result to console
    console.log("\n--- AI Optimization Summary ---");
    console.log(`Estimated Savings: $${aiResult.estimatedSavings} (${aiResult.savingsPercentage}%)`);
    console.log(aiResult.summary);
    
    // Post to Pull Request if running in a GitHub Action pull request context
    if (!isLocal && token && (github.context.eventName === "pull_request" || issueNumber)) {
      console.log(`💬 Posting AI PR Review and suggestions to PR #${issueNumber}...`);
      
      const commitId = github.context.payload.pull_request?.head?.sha || github.context.sha;
      const comments = [];
      let reviewBody = commentBody;

      if (aiResult.recommendations?.length) {
        const generalRecs = [];
        aiResult.recommendations.forEach((rec) => {
          const filePath = rec.filePath || rec.workflow;
          const startLine = Number(rec.startLine);
          if (filePath && !isNaN(startLine)) {
            comments.push({
              path: filePath,
              line: startLine,
              side: "RIGHT",
              body: formatRecommendationComment(rec)
            });
          } else {
            generalRecs.push(rec);
          }
        });

        if (generalRecs.length > 0) {
          reviewBody += "\n\n### 💡 Additional Recommendations\n";
          generalRecs.forEach((rec) => {
            reviewBody += `\n---\n\n> #### ⚠️ Potential cost optimization | ${rec.impact === "high" ? "🔴 Major" : rec.impact === "medium" ? "🟡 Medium" : "🟢 Minor"}\n>\n> **${rec.title}**\n>\n> ${rec.description}\n>\n> 💰 **If you optimize this, you save:** $${rec.estimatedSavings || 0}/mo\n`;
          });
        }
      }

      await createPRReview({
        token,
        owner,
        repo,
        pullNumber: issueNumber,
        commitId,
        body: reviewBody,
        comments
      });
      console.log("✅ PR review and inline comments posted successfully!");
    } else {
      console.log("\n--- Generated Markdown Comment (Console Output) ---");
      let fullConsoleComment = commentBody;
      if (aiResult.recommendations?.length) {
        aiResult.recommendations.forEach((rec) => {
          const blockContent = formatRecommendationComment(rec);
          const formattedBlock = blockContent.split("\n").map(l => {
            if (l.trim().startsWith("```") || l.trim().startsWith("+") || l.trim().startsWith("-")) {
              return l;
            }
            return `> ${l}`;
          }).join("\n");
          fullConsoleComment += `\n\n---\n\n${formattedBlock}`;
        });
      }
      console.log(fullConsoleComment);
    }
  } else {
    // Print the static repo scanner report
    printConsoleReport(staticResult);
    
    if (!isLocal && token && github.context.eventName === "pull_request") {
      console.log("💬 Posting static optimization comment to PR...");
      const octokit = github.getOctokit(token);
      await postStaticPRComment(octokit, staticResult);
    }
  }

  // Fail action if configured
  if (!isLocal && failOn !== "none") {
    const issuesToCheck = aiResult ? aiResult.issues : staticResult.issues;
    const shouldFail = shouldFailAction(issuesToCheck, failOn);
    if (shouldFail) {
      core.setFailed(`Cost Optimizer found issues matching or exceeding "${failOn}" severity.`);
    }
  }
}

function printConsoleReport(result) {
  console.log("\n💰 GitHub Cost Optimizer (Static Report)\n");
  console.log(`Scanned files: ${result.scannedFiles}`);
  console.log(`Potential monthly savings: $${result.totalSavings.toFixed(0)}`);
  console.log(`Issues found: ${result.issues.length}\n`);

  for (const issue of result.issues) {
    console.log(
      `[${issue.severity.toUpperCase()}] ${issue.title} — ${issue.file}:${issue.line}`
    );
    console.log(`  ${issue.recommendation}`);
    if (issue.estimatedMonthlySavings > 0) {
      console.log(`  Potential savings: ~$${issue.estimatedMonthlySavings}/month`);
    }
  }
}

async function postStaticPRComment(octokit, result) {
  const { owner, repo } = github.context.repo;
  const issueNumber = github.context.issue.number;

  const grouped = {};
  for (const issue of result.issues) {
    if (!grouped[issue.category]) grouped[issue.category] = [];
    grouped[issue.category].push(issue);
  }

  let md = `# 💰 GitHub Cost Optimizer\n\n`;
  md += `> Scanned **${result.scannedFiles}** supported files and found **${result.issues.length}** potential optimization opportunities.\n\n`;
  md += `## 💵 Estimated Impact\n\n`;
  md += `| Category | Issues | Potential Savings |\n`;
  md += `|---|---:|---:|\n`;

  for (const [category, issues] of Object.entries(grouped)) {
    const savings = issues.reduce((sum, i) => sum + i.estimatedMonthlySavings, 0);
    md += `| ${category} | ${issues.length} | ~$${savings}/mo |\n`;
  }
  md += `| **Total** | **${result.issues.length}** | **~$${result.totalSavings.toFixed(0)}/mo** |\n\n`;

  if (!result.issues.length) {
    md += `## ✅ No known optimization opportunities found\n\n`;
  } else {
    const severityOrder = ["critical", "high", "medium", "low"];
    for (const severity of severityOrder) {
      const issues = result.issues.filter(i => i.severity === severity);
      if (!issues.length) continue;

      const icon = severity === "critical" ? "🚨" :
        severity === "high" ? "🔴" :
        severity === "medium" ? "🟡" : "🟢";

      md += `## ${icon} ${severity[0].toUpperCase()}${severity.slice(1)} Priority\n\n`;

      for (const issue of issues) {
        md += `### ${issue.title}\n\n`;
        md += `📁 \`${issue.file}:${issue.line}\`\n\n`;
        md += `**Category:** ${issue.category}  \n`;
        md += `**Problem:** ${issue.problem}  \n`;
        md += `**Recommendation:** ${issue.recommendation}\n\n`;

        if (issue.estimatedMonthlySavings > 0) {
          md += `💵 **Potential savings:** ~$${issue.estimatedMonthlySavings}/month\n\n`;
        }
      }
    }
  }

  md += `---\n\nGenerated by **GitHub Cost Optimizer**.`;

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: md
  });
}

function shouldFailAction(issues, failOn) {
  if (!failOn || failOn === "none") return false;

  const levels = { low: 1, medium: 2, high: 3, critical: 4 };
  const threshold = levels[failOn];

  if (!threshold) return false;

  return issues.some(issue => {
    const severity = (issue.severity || "low").toLowerCase();
    return levels[severity] >= threshold;
  });
}

main().catch(error => {
  console.error("❌ Fatal Error:", error);
  core.setFailed(error.message);
});
