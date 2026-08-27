# Local Distribution Design

## Goal

Let a user create a private local Travel Story workspace with one command, then run it with Node.js and FFmpeg. Keep the application as a self-hosted single-user tool.

## Command

Publish the repository as the npm package `@wang-bool/create-travel-story`. Users run:

```bash
npx @wang-bool/create-travel-story my-travel-story
```

The command copies the application source into `my-travel-story`, creates its local data directories through normal application startup, installs dependencies unless `--skip-install` is passed, and reports the commands required to configure keys and start the app. The generated app keeps the name `travel-story`; the generator package name does not leak into the generated `package.json`.

## Runtime checks

The generator requires Node.js 20 or later. It checks for `ffmpeg` and prints a warning when it is absent because planning still works without video export. It rejects an existing non-empty target directory and does not write outside the specified target.

## Package contents

The npm package contains the tracked application files needed to run Travel Story and the generator executable. It excludes runtime data, map caches, `.next`, dependencies, local secrets, Git metadata, internal implementation plans, and the generator executable from the generated project.

## Documentation and discovery

The README gains a short `npx` quick-start path. A repository listing document records the GitHub description, topic set, and submission copy for r/selfhosted, HelloGitHub, Gitee Community, Product Hunt, Show HN, and awesome-selfhosted. External repository settings and submissions remain manual actions because the local checkout has no authenticated access to those services.

## Testing

Node tests cover target validation, copied-file filtering, generated package metadata, and the `--skip-install` path. The package gains `test` and `check` scripts so the release gate is one command.
