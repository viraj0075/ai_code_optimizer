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

export async function createPRReview({
  token,
  owner,
  repo,
  pullNumber,
  commitId,
  body,
  comments,
}) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${token}`,

        Accept: "application/vnd.github+json",

        "X-GitHub-Api-Version": "2022-11-28",

        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        commit_id: commitId,
        event: "COMMENT",
        body,
        comments,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `GitHub API error creating review ${response.status}: ${error}`
    );
  }

  return response.json();
}
