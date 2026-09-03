/**
 * Simple updater utility to check the latest git tag / release on GitHub (thutil/dodb)
 */

export interface UpdateCheckResult {
  status: "idle" | "checking" | "up-to-date" | "update-available" | "error";
  latestTag?: string;
  releaseUrl?: string;
  errorMessage?: string;
}

export function cleanTag(tag: string): string {
  return tag.trim().replace(/^v\.?/i, "");
}

/**
 * Checks GitHub for the latest release tag and compares with currentVersion.
 */
export async function checkGitTagUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  const current = cleanTag(currentVersion);

  try {
    // Check GitHub tags (lightweight, direct tag check)
    const res = await fetch("https://api.github.com/repos/thutil/dodb/tags", {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const tags = await res.json();
    if (!Array.isArray(tags) || tags.length === 0) {
      return { status: "up-to-date", latestTag: currentVersion };
    }

    const latestTag = tags[0].name || "";
    const cleanLatest = cleanTag(latestTag);

    // If tag matches current version: up to date
    if (cleanLatest === current) {
      return {
        status: "up-to-date",
        latestTag,
      };
    }

    // Different tag -> new available
    return {
      status: "update-available",
      latestTag,
      releaseUrl: `https://github.com/thutil/dodb/releases/tag/${latestTag}`,
    };
  } catch (err: any) {
    return {
      status: "error",
      errorMessage: err?.message || "Check failed",
    };
  }
}
