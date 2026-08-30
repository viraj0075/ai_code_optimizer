export function buildCostOptimizationPrompt(data) {
  return `
You are an expert GitHub Actions and CI/CD
cost optimization AI.

Analyze the provided GitHub Actions data.

Repository:
${data.repository || "Unknown"}

Current estimated cost:
$${Number(data.totalCost || 0).toFixed(2)}

Jobs:

${JSON.stringify(data.jobs, null, 2)}

Find realistic ways to reduce CI/CD costs.

Analyze:

1. Expensive runners
2. Long-running jobs
3. Duplicate jobs
4. Duplicate workflow executions
5. Unnecessary workflow triggers
6. Missing dependency caching
7. Repeated npm installations
8. Excessive CI frequency
9. Unnecessary builds
10. Unnecessary tests
11. Artifact inefficiencies
12. Matrix strategy inefficiencies
13. Jobs that should use conditions
14. Pull request optimization
15. Branch optimization
16. Runner optimization

IMPORTANT:

Do not recommend something just because it is
cheaper.

Only recommend technically reasonable changes.

Do not invent data.

Only use the information provided.

For each issue provide:

- title
- severity
- explanation
- estimated savings

For each recommendation provide:

- title
- description
- impact
- estimated savings
- workflow
- YAML fix when possible

Return ONLY valid JSON.

Use this structure:

{
  "summary": "Overall analysis",

  "estimatedSavings": 0,

  "savingsPercentage": 0,

  "issues": [
    {
      "title": "Issue title",
      "severity": "high",
      "explanation": "Explanation",
      "estimatedSavings": 0
    }
  ],

  "recommendations": [
    {
      "title": "Recommendation",
      "description": "Description",
      "impact": "high",
      "estimatedSavings": 0,
      "workflow": ".github/workflows/ci.yml",
      "yaml": "YAML fix"
    }
  ]
}
`;
}
