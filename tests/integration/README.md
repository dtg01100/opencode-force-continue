# Integration Tests

These tests validate the force-continue plugin by spawning isolated OpenCode instances.

## Why Subprocess Tests?
We develop this plugin using OpenCode itself. Running tests in the active session would risk:
- Breaking the development session with bugs
- Interfering with ongoing work
- False positives due to plugin already being loaded

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Run specific test file
npm run test:integration -- tests/integration/server-plugin.test.mjs

# Run in watch mode
npm run test:integration:watch
```

## Test Types
- **server-plugin.test.mjs**: Tests non-interactive mode plugin loading and tools
- **tui-plugin.test.mjs**: Tests TUI mode with PTY emulation
- **full-integration.test.mjs**: End-to-end session lifecycle tests

## Safety
Each test:
- Runs in a temporary directory (`/tmp/opencode-test-*`)
- Uses isolated HOME and config
- Loads plugin from local path
- Cleans up on exit (even on failure)
- Has timeouts to prevent hanging

## Requirements
- OpenCode CLI installed and in PATH
- Sufficient API quota for test model calls
- Network access for model API calls

## Troubleshooting
If tests hang:
- Check `OPENCODE_TEST_TIMEOUT` environment variable
- Look for zombie processes: `ps aux | grep opencode`
- Kill leftover test dirs: `rm -rf /tmp/opencode-test-*`