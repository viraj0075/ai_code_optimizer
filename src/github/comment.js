export async function createPRComment({
  token,
  owner,
  repo,
  issueNumber,
  body,
}) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${token}`,

        Accept:
          "application/vnd.github+json",

        "X-GitHub-Api-Version":
          "2022-11-28",

        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        body,
      }),
    }
  );

  if (!response.ok) {
    const error =
      await response.text();

    throw new Error(
      `GitHub API error ${response.status}: ${error}`
    );
  }

  return response.json();
}
