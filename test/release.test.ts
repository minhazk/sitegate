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
  const packageJob = workflow.slice(workflow.indexOf("  package:"), workflow.indexOf("  publish:"));
  const publishJob = workflow.slice(workflow.indexOf("  publish:"));

  it("requires the release tag to match the package version", () => {
    expect(workflow).toContain("github.event.release.tag_name");
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/tags/$RELEASE_TAG"');
    expect(workflow).toContain('test "$RELEASE_TAG" = "v$PACKAGE_VERSION"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$TAG_SHA"');
    expect(workflow).toContain('git merge-base --is-ancestor "$TAG_SHA" origin/main');
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("attaches the verified tag commit to main for publish-time Git checks", () => {
    expect(packageJob).toContain('git switch --force-create main "$TAG_SHA"');
    expect(packageJob).toContain('test "$(git branch --show-current)" = "main"');
    expect(packageJob).toContain('test -z "$(git status --porcelain)"');
  });

  it("keeps OIDC publication authority out of repository-controlled validation", () => {
    expect(workflow.slice(0, workflow.indexOf("jobs:"))).not.toContain("id-token: write");
    expect(packageJob).not.toContain("id-token: write");
    expect(packageJob).toContain("pnpm check");
    expect(publishJob).toContain("id-token: write");
    expect(publishJob).toContain("contents: none");
  });

  it("transfers one checksummed immutable tarball between isolated jobs", () => {
    expect(packageJob).toContain('PNPM_CONFIG_IGNORE_SCRIPTS: "true"');
    expect(packageJob).toContain("pnpm pack --pack-destination release-artifact");
    expect(packageJob).toContain('sha256sum "$TARBALL"');
    expect(packageJob).toContain("actions/upload-artifact@");
    expect(packageJob).toContain("# v7.0.1");
    expect(publishJob).toContain("actions/download-artifact@");
    expect(publishJob).toContain("# v8.0.1");
    expect(publishJob).toContain('sha256sum --check "$TARBALL.sha256"');
  });

  it("publishes the verified tarball without checking out or executing repository scripts", () => {
    expect(publishJob).not.toContain("actions/checkout@");
    expect(publishJob).not.toContain("pnpm install");
    expect(publishJob).not.toContain("pnpm check");
    expect(publishJob).not.toContain("pnpm build");
    expect(publishJob).toContain('pnpm publish "$TARBALL"');
    expect(publishJob).toContain('PNPM_CONFIG_IGNORE_SCRIPTS: "true"');
    expect(publishJob).toContain("--no-git-checks");
  });

  it("pins every external action to an immutable commit SHA", () => {
    const uses = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s+([^\s#]+)/gmu)].map(
      (match) => match[1],
    );
    expect(uses.length).toBeGreaterThanOrEqual(5);
    for (const action of uses) {
      expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/u);
    }
  });
});
