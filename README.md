# 💰 GitHub Cost Optimizer

An AI-powered GitHub Action that scans your repository's workflows and codebase for cloud-cost optimization opportunities. It automatically calculates your current CI/CD costs, analyzes run-time patterns, and leaves actionable recommendations directly on Pull Requests.

---

## 🚀 How to Work (Local Development)

### 1. Prerequisites
- **Node.js**: Version 18 or higher (Node v24 is recommended and tested).
- **OpenRouter API Key**: Required for AI-powered optimization. You can get one from [OpenRouter](https://openrouter.ai/).

### 2. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/viraj0075/github-cost-optimizer.git
cd github-cost-optimizer
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root of the project with the following keys:
```env
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=nvidia/nemotron-3.5-lightning:free
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
```

### 4. Run the Cost Optimizer Locally
Scan the local repository and generate reports in the console:
```bash
npm run analyze
```
*This command runs the static codebase scans and requests cost optimization recommendations from the AI.*

---

## 📦 How to Build and Deploy (GitHub Actions)

Since GitHub Actions run using a self-contained bundle, any changes to the source code must be compiled before deploying.

### Step 1: Package the Action
Compile the JavaScript codebase into a single distribution file:
```bash
npm run package
```
This builds and outputs a compiled file at:
```text
dist/index.js
```
Make sure to commit and push `dist/index.js` to your GitHub repository!

### Step 2: Use the Action in a Workflow
Create a new workflow file in the repository you wish to scan (e.g., `.github/workflows/cost-optimizer.yml`):

```yaml
name: Cost Optimizer

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  cost-analysis:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Run AI Cost Optimizer
        uses: viraj0075/github-cost-optimizer@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on: none
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_MODEL: nvidia/nemotron-3.5-lightning:free
          OPENROUTER_URL: https://openrouter.ai/api/v1/chat/completions
```

### Configuration Inputs
| Input Parameter | Description | Required | Default |
|---|---|---|---|
| `github-token` | The `GITHUB_TOKEN` secret to allow posting comments to PRs. | Yes | N/A |
| `fail-on` | Severity threshold to fail the build (`none`, `low`, `medium`, `high`, `critical`). | No | `none` |

---

## 🛠️ How it Works Under the Hood

1. **Workflow Scanning**: The action scans `.github/workflows/` to calculate the estimated monthly cost based on runner types and durations.
2. **AI Analysis**: It sends workflow and codebase metadata to the OpenRouter API.
3. **PR Feedback**: The AI findings and automated code suggestions are posted as a summary comment on the Pull Request.

---

## License
MIT
