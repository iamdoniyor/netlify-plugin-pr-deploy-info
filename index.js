const { Octokit } = require("@octokit/rest");

module.exports = {
  onSuccess: async ({ inputs }) => {
    // Only run on deploy preview context
    const context = process.env.CONTEXT;
    const isPullRequest = process.env.PULL_REQUEST === "true";
    const reviewId = process.env.REVIEW_ID;

    if (context !== "deploy-preview" || !isPullRequest) {
      return;
    }

    // Verify required environment variables
    const githubToken = process.env.GITHUB_TOKEN;
    const repositoryUrl = process.env.REPOSITORY_URL;
    const deployUrl = process.env.DEPLOY_PRIME_URL;
    const commitRef = process.env.COMMIT_REF;

    if (!githubToken) {
      console.error("ERROR: GITHUB_TOKEN environment variable is not set");
      return;
    }

    if (!reviewId) {
      console.error("ERROR: REVIEW_ID environment variable is not set");
      return;
    }

    if (!repositoryUrl) {
      console.error("ERROR: REPOSITORY_URL environment variable is not set");
      return;
    }

    // Parse owner and repo from REPOSITORY_URL
    // Format: https://github.com/owner/repo or https://github.com/owner/repo.git
    let owner, repo;
    try {
      const urlMatch = repositoryUrl.match(
        /github\.com[:/]([^/]+)\/(.+?)(\.git)?$/
      );
      if (!urlMatch) {
        console.error("ERROR: Could not parse REPOSITORY_URL:", repositoryUrl);
        return;
      }
      owner = urlMatch[1];
      repo = urlMatch[2].replace(/\.git$/, "");
    } catch (error) {
      console.error("ERROR: Failed to parse repository URL:", error.message);
      return;
    }

    // Get backend API URL from configurable env var
    const envVarName = inputs.envVarName || "VITE_GATEWAY_API_URL";
    const backendEnv = process.env[envVarName] || "unknown";

    // Get short commit SHA
    const shortCommit = commitRef ? commitRef.substring(0, 7) : "unknown";

    // Get site name from deploy URL
    const siteName = deployUrl ? deployUrl.match(/https?:\/\/[^.]+\.([^.]+\.[^.]+)/)?.[1] || 'site' : 'site';

    // Get deploy log URL
    const deployId = process.env.DEPLOY_ID || '';
    const siteId = process.env.SITE_ID || '';
    const deployLogUrl = deployId && siteId
      ? `https://app.netlify.com/sites/${siteId}/deploys/${deployId}`
      : '';

    // Create comment body with unique identifier
    const commentIdentifier = "<!-- netlify-pr-deploy-info -->";
    const commentBody = `${commentIdentifier}
### <span aria-hidden="true">✅</span> Deploy Preview for *${siteName}* ready!


|  Name | Link |
|:-:|------------------------|
|<span aria-hidden="true">🔨</span> Latest commit | ${commitRef || 'N/A'} |
|<span aria-hidden="true">🔍</span> Latest deploy log | ${deployLogUrl || 'N/A'} |
|<span aria-hidden="true">😎</span> Deploy Preview | [${deployUrl}](${deployUrl}) |
|<span aria-hidden="true">🌳</span> Backend environment | \`${backendEnv}\` |
---
<!-- [${siteName} Preview](${deployUrl}) -->`;

    // Post or update comment on GitHub PR
    try {
      const octokit = new Octokit({
        auth: githubToken,
      });

      // Find existing comment from this plugin
      const { data: comments } = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: parseInt(reviewId, 10),
      });

      const existingComment = comments.find((comment) =>
        comment.body.includes(commentIdentifier)
      );

      if (existingComment) {
        // Update existing comment
        await octokit.issues.updateComment({
          owner,
          repo,
          comment_id: existingComment.id,
          body: commentBody,
        });
      } else {
        // Create new comment
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: parseInt(reviewId, 10),
          body: commentBody,
        });
      }
    } catch (error) {
      console.error("ERROR: Failed to post comment to GitHub:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error(
          "Response data:",
          JSON.stringify(error.response.data, null, 2)
        );
      }
      // Don't fail the build if comment posting fails
      return;
    }
  },
};
