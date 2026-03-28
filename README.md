# opencode-force-continue

Forces OpenCode AI to continue when the model stops early. The AI must call `completionSignal` before stopping.

## Installation

```bash
npm install @dtg01100/opencode-force-continue
```

Add to your `opencode.json`:

```json
{
  "plugin": ["@dtg01100/opencode-force-continue"]
}
```

## Usage

When this plugin is active, OpenCode will inject a system message requiring the AI to call `completionSignal` when finished with a task.

If the AI stops without calling it (session becomes idle), the plugin automatically prompts "Continue" to keep the agent running.

## Requirements

- OpenCode AI
- `@opencode-ai/plugin` (peer dependency, installed automatically with OpenCode)

## Publishing

Releases are published to npm automatically when a GitHub Release is created. The workflow requires an `NPM_TOKEN` secret to authenticate with the npm registry.

### Setting up the NPM_TOKEN secret

**1. Create an npm access token**

1. Log in to [npmjs.com](https://www.npmjs.com) and go to your profile → **Access Tokens**.
2. Click **Generate New Token** → **Granular Access Token**.
3. Give the token a name (e.g. `opencode-force-continue-publish`).
4. Under **Packages and scopes**, set **Read and write** permission for the `@dtg01100/opencode-force-continue` package (or allow all packages under your scope).
5. Click **Generate Token** and copy it — you won't be able to see it again.

**2. Add the token as a GitHub Actions secret**

1. Go to the repository on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Set the name to `NPM_TOKEN` and paste the token you copied.
4. Click **Add secret**.

**3. Create a release to trigger publishing**

Push a version bump commit, then go to **Releases** → **Draft a new release**, create a tag (e.g. `v1.0.1`), and publish the release. The **Node.js Package** workflow will run tests and publish to npm automatically.

## License

MIT
