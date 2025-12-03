const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");

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
    const repositoryUrl = process.env.REPOSITORY_URL;
    const deployUrl = process.env.DEPLOY_PRIME_URL;
    const commitRef = process.env.COMMIT_REF;

    // Check for GitHub App credentials or personal token
    const githubAppId = process.env.GITHUB_APP_ID;
    const githubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    const githubAppInstallationId = process.env.GITHUB_APP_INSTALLATION_ID;
    const githubToken = process.env.GITHUB_TOKEN;

    const hasGitHubApp = githubAppId && githubAppPrivateKey && githubAppInstallationId;
    const hasPersonalToken = githubToken;

    if (!hasGitHubApp && !hasPersonalToken) {
      console.error("ERROR: Either GitHub App credentials (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID) or GITHUB_TOKEN must be set");
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

    // Get site name from Netlify environment variable
    const siteName = process.env.SITE_NAME || 'site';

    // Get deploy log URL
    const deployId = process.env.DEPLOY_ID || '';
    const deployLogUrl = deployId && siteName
      ? `https://app.netlify.com/projects/${siteName}/deploys/${deployId}`
      : '';

    // Generate QR code URL using a public QR code API
    // Using api.qrserver.com which is a free, reliable service
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(deployUrl)}`;

    // Build QR code cell content (inside table like Netlify does)
    const qrCodeCell = `<details><summary>📱 Toggle QR Code...</summary><br /><br />![QR Code](${qrCodeUrl})<br /><br />_Use your smartphone camera to open QR code link._</details>`;

    // Create comment body with unique identifier
    const commentIdentifier = "<!-- netlify-pr-deploy-info -->";
    const commentBody = `${commentIdentifier}
### <span aria-hidden="true">✅</span> Deploy Preview for *${siteName}* ready!


|  Name | Link |
|:-:|------------------------|
|<span aria-hidden="true">🔨</span> Latest commit | ${commitRef || 'N/A'} |
|<span aria-hidden="true">🔍</span> Latest deploy log | ${deployLogUrl || 'N/A'} |
|<span aria-hidden="true">😎</span> Deploy Preview | [${deployUrl}](${deployUrl}) |
|<span aria-hidden="true">📱</span> Preview on mobile | ${qrCodeCell} |
|<span aria-hidden="true">🌳</span> Backend environment | \`${backendEnv}\` |
---
<!-- [${siteName} Preview](${deployUrl}) -->`;

    // Post or update comment on GitHub PR
    try {
      // Initialize Octokit with GitHub App or personal token
      let octokit;

      if (hasGitHubApp) {
        console.log("✓ Using GitHub App authentication");
        octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: githubAppId,
            privateKey: githubAppPrivateKey,
            installationId: githubAppInstallationId,
          },
        });
      } else {
        console.log("✓ Using personal access token authentication");
        octokit = new Octokit({
          auth: githubToken,
        });
      }

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
