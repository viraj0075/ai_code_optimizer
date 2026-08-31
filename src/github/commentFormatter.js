export function formatAIComment(result) {
  let comment = `## 🤖 AI Cost Optimizer

### 📊 Cost Analysis

| Metric | Value |
|---|---:|
| Current Cost | $${result.currentCost} |
| Potential Savings | $${result.estimatedSavings} |
| Possible Reduction | ${result.savingsPercentage}% |

### 💡 AI Recommendations

${result.summary}
`;

  if (
    result.recommendations?.length
  ) {
    result.recommendations.forEach(
      (recommendation, index) => {
        const file = recommendation.filePath || recommendation.workflow;
        
        let originalLines = [];
        if (typeof recommendation.originalCode === "string") {
          originalLines = recommendation.originalCode.split(/\r?\n/);
        } else if (Array.isArray(recommendation.originalCode)) {
          originalLines = recommendation.originalCode;
        }

        let suggestedLines = [];
        const fixCode = recommendation.suggestedCode || recommendation.codeFix || recommendation.yaml;
        if (typeof fixCode === "string") {
          suggestedLines = fixCode.split(/\r?\n/);
        } else if (Array.isArray(fixCode)) {
          suggestedLines = fixCode;
        }

        let diffContent = "";
        if (originalLines.length > 0) {
          diffContent += originalLines.map(line => `-${line}`).join("\n");
        }
        if (suggestedLines.length > 0) {
          if (diffContent) diffContent += "\n";
          diffContent += suggestedLines.map(line => `+${line}`).join("\n");
        }

        const icon = recommendation.impact === "high" ? "🔴 Major" :
                     recommendation.impact === "medium" ? "🟡 Medium" : "🟢 Minor";

        comment += `

---

### ⚠️ Potential cost optimization | ${icon}

**${recommendation.title}**

${recommendation.description}

💰 **If you optimize this, you save:** $${recommendation.estimatedSavings || 0}/mo
`;

        if (file) {
          comment += `
**File:** \`${file}\`
`;
        }

        if (diffContent) {
          comment += `

\`\`\`diff
${diffContent}
\`\`\`
`;
        }
      }
    );
  }

  comment += `

---

`;

  return comment;
}
