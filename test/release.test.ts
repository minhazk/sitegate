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
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$TAG_SHA"');
    expect(workflow).toContain('git merge-base --is-ancestor "$TAG_SHA" origin/main');
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("attaches the verified tag commit to main for publish-time Git checks", () => {
    expect(workflow).toContain('git switch --force-create main "$TAG_SHA"');
    expect(workflow).toContain('test "$(git branch --show-current)" = "main"');
    expect(workflow).toContain('test -z "$(git status --porcelain)"');
    expect(workflow).not.toContain("--no-git-checks");
  });
});
