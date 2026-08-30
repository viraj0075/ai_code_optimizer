const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

module.exports.analyzeWorkflows = async function ({ repoPath, token, owner, repo }) {
  const workflowsDir = path.join(repoPath, ".github", "workflows");
  const jobsList = [];

  // 1. Scan and parse local workflow YAML files
  if (fs.existsSync(workflowsDir)) {
    let files = [];
    try {
      files = fs.readdirSync(workflowsDir).filter(
        (file) => file.endsWith(".yml") || file.endsWith(".yaml")
      );
    } catch (err) {
      console.warn("⚠️ Warning: Could not read workflows directory:", err.message);
    }

    for (const file of files) {
      const filePath = path.join(workflowsDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const doc = yaml.load(content);

        if (doc && doc.jobs) {
          const triggers = doc.on || {};
          
          for (const [jobId, jobData] of Object.entries(doc.jobs)) {
            // Determine runner type
            let runner = "ubuntu-latest";
            if (typeof jobData["runs-on"] === "string") {
              runner = jobData["runs-on"];
            } else if (Array.isArray(jobData["runs-on"])) {
              runner = jobData["runs-on"].join(", ");
            }

            // Extract steps summary for AI context
            const steps = Array.isArray(jobData.steps)
              ? jobData.steps.map((s) => s.name || s.uses || s.run || "Unnamed step")
              : [];

            jobsList.push({
              workflow: file,
              job: jobId,
              runner,
              steps,
              triggers,
              durationMinutes: 10, // Default fallback
              runs: 100,           // Default fallback
              isMockData: true
            });
          }
        }
      } catch (err) {
        console.warn(`⚠️ Warning: Failed to parse workflow file ${file}:`, err.message);
      }
    }
  }

  // 2. Fetch real stats if GitHub token and owner/repo are available
  if (token && owner && repo) {
    try {
      console.log(`📊 Fetching run history for ${owner}/${repo}...`);
      
      // Fetch workflow runs (up to 100 runs)
      const runsResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
          }
        }
      );

      if (runsResponse.ok) {
        const runsData = await runsResponse.json();
        const runs = runsData.workflow_runs || [];

        if (runs.length > 0) {
          // Compute run frequencies for workflows in the list
          const workflowRunCounts = {};
          let earliestDate = new Date();
          let latestDate = new Date(0);

          for (const run of runs) {
            const workflowFile = path.basename(run.path);
            workflowRunCounts[workflowFile] = (workflowRunCounts[workflowFile] || 0) + 1;

            const runDate = new Date(run.created_at);
            if (runDate < earliestDate) earliestDate = runDate;
            if (runDate > latestDate) latestDate = runDate;
          }

          const timespanMs = latestDate - earliestDate;
          const timespanDays = timespanMs / (1000 * 60 * 60 * 24) || 1;

          // Estimate monthly runs for each workflow
          const workflowMonthlyRuns = {};
          for (const [wFile, count] of Object.entries(workflowRunCounts)) {
            workflowMonthlyRuns[wFile] = Math.round((count / timespanDays) * 30);
          }

          // Fetch job details for the last 15 completed runs to compute average job durations
          const completedRuns = runs
            .filter((run) => run.status === "completed")
            .slice(0, 15);

          const jobDurations = {};

          await Promise.all(
            completedRuns.map(async (run) => {
              try {
                const jobsResponse = await fetch(
                  `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`,
                  {
                    headers: {
                      Authorization: `Bearer ${token}`,
                      Accept: "application/vnd.github+json",
                      "X-GitHub-Api-Version": "2022-11-28"
                    }
                  }
                );

                if (jobsResponse.ok) {
                  const jobsData = await jobsResponse.json();
                  const workflowFile = path.basename(run.path);

                  for (const job of jobsData.jobs || []) {
                    if (job.status === "completed" && job.started_at && job.completed_at) {
                      const durationMs = new Date(job.completed_at) - new Date(job.started_at);
                      const durationMins = durationMs / 60000;

                      const key = `${workflowFile}:${job.name}`;
                      if (!jobDurations[key]) {
                        jobDurations[key] = [];
                      }
                      jobDurations[key].push(durationMins);
                    }
                  }
                }
              } catch (e) {
                // Ignore single run fetch error
              }
            })
          );

          // Update our jobsList with the fetched stats
          for (const job of jobsList) {
            const monthlyRuns = workflowMonthlyRuns[job.workflow];
            if (typeof monthlyRuns === "number") {
              job.runs = monthlyRuns;
              job.isMockData = false;
            }

            // Find matching job duration keys (by job key or job name)
            const durationKey = `${job.workflow}:${job.job}`;
            const durations = jobDurations[durationKey];

            if (durations && durations.length > 0) {
              const averageDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
              job.durationMinutes = Number(averageDuration.toFixed(2));
              job.isMockData = false;
            }
          }
        }
      } else {
        const errMsg = await runsResponse.text();
        console.warn(`⚠️ Warning: GitHub Runs API returned error ${runsResponse.status}:`, errMsg);
      }
    } catch (err) {
      console.warn("⚠️ Warning: Failed to retrieve run history from GitHub API:", err.message);
    }
  }

  return jobsList;
}
