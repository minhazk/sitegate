import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("release workflow", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  it("requires the release tag to match the package version", () => {
    expect(workflow).toContain("github.event.release.tag_name");
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/tags/$RELEASE_TAG"');
    expect(workflow).toContain('test "$RELEASE_TAG" = "v$PACKAGE_VERSION"');
    expect(workflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("does not bypass publish-time Git checks", () => {
    expect(workflow).not.toContain("--no-git-checks");
  });
});
