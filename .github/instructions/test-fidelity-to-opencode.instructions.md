---
description: "Tests must fully match OpenCode's actual runtime behaviors, API shapes, and plugin loading semantics"
applyTo: "**/__tests__/**"
---

# Test Fidelity to OpenCode Runtime

## Core Principle

Tests must replicate OpenCode's actual runtime behavior, not just verify internal logic. When tests pass but the plugin fails in production, the tests are incorrect.

## API Shape Requirements

### TUI Plugin API Mocks

Tests must mock the full OpenCode `TuiPluginApi` shape:

```typescript
const mockApi = {
  command: {
    register: vi.fn(() => vi.fn()), // returns dispose function
    trigger: vi.fn(),
    show: vi.fn(),
  },
  ui: {
    toast: vi.fn(),
    Dialog: vi.fn(),
    // ... other UI components as needed
  },
  route: {
    register: vi.fn(),
    navigate: vi.fn(),
    current: { name: 'session', params: { sessionID: 'test-id' } },
  },
  keybind: {
    match: vi.fn(),
    print: vi.fn(),
    create: vi.fn(() => ({})),
  },
  state: { /* ... */ },
  theme: { /* ... */ },
  // Only mock what the plugin actually uses
};
```

### Server Plugin API Mocks

Server plugins receive `PluginInput` with different shape. Verify against `@opencode-ai/plugin` types.

## Plugin Loading Semantics

### v1 Spec Compliance Tests

- Server module: `{ id, server }` - NO `tui` property
- TUI module: `{ id, tui }` - NO `server` property  
- Package exports: separate `./server` and `./tui` paths
- Never test cross-contamination between server/TUI modules

### Module Resolution Tests

Verify actual Node.js package resolution:
- `import plugin from 'force-continue'` → server module
- `import { tui } from 'force-continue/tui'` → TUI module
- Don't just check export shapes - verify import paths work

## Runtime Behavior Verification

### Command Registration/Refresh

- Commands MUST re-register after state changes
- Test that `api.command.register()` receives updated command providers
- Verify dispose functions are called before re-registration
- Don't mock away the registration flow - it's critical to UI updates

### State Persistence

- Test actual file writes/reads for persistence
- Use temporary directories, not in-memory mocks for state
- Verify state survives module re-imports

### Error Handling

- Test graceful degradation when API features are missing
- Verify no crashes on partial API implementations
- Test both sync and async error paths

## Test Patterns

### Good: Tests actual OpenCode integration

```typescript
it('re-registers commands after toggle', async () => {
  let commandsProvider: () => any[];
  const register = vi.fn((provider) => {
    commandsProvider = provider;
    return vi.fn();
  });

  await tui({ command: { register }, /* ... */ });
  
  // Initial registration
  expect(register).toHaveBeenCalledTimes(1);
  
  // Simulate user action that changes state
  commandsProvider()[0].onSelect();
  
  // Should re-register with updated state
  expect(register).toHaveBeenCalledTimes(2);
});
```

### Bad: Tests only internal logic

```typescript
// BAD: Doesn't verify OpenCode API integration
it('toggles state', () => {
  const state = { enabled: true };
  toggle(state); // Internal function
  expect(state.enabled).toBe(false);
});
```

## Validation Checklist

When writing/updating tests, verify:

1. **API shapes match** - Compare against OpenCode source or type definitions
2. **Module loading works** - Test actual imports, not just export objects
3. **State flows correctly** - Changes propagate to UI/commands
4. **Error cases handled** - Missing API features don't crash
5. **v1 spec enforced** - No server/TUI mixing in tests
6. **Cleanup works** - `beforeEach`/`afterEach` resets state properly

## References

- OpenCode TUI runtime: `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- Plugin types: `@opencode-ai/plugin/tui`
- Test fixtures: OpenCode repo `test/fixture/tui-plugin.ts`
