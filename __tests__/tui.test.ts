import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { readAutopilotState, writeAutopilotState, resetAutopilotState } from '../src/autopilot.js';

function makeMockApi(onDialogOpen?: (props: any) => void) {
  let getCommandsFn: (() => any[]) | null = null;
  let dialogProps: any = null;

  const mockApi: any = {
    command: {
      // register stores the callback; calling getCommands() returns fresh commands
      register: (fn: any) => {
        getCommandsFn = fn;
        return () => {}; // deregister fn
      },
    },
    ui: {
      dialog: {
        // replace calls the render function to obtain the JSX element (and its props)
        replace: (renderFn: () => any) => {
          renderFn(); // triggers DialogConfirm call, capturing props via side effect
          onDialogOpen?.(dialogProps);
        },
        clear: () => {},
      },
      // DialogConfirm is a JSX component; capture props so tests can trigger onConfirm/onCancel
      DialogConfirm: (props: any) => {
        dialogProps = props;
        return null; // mock JSX element
      },
      toast: (_: any) => {},
    },
    _getCommands: () => getCommandsFn?.() ?? [],
    _getDialogProps: () => dialogProps,
  };

  return mockApi;
}

describe('TUI autopilot toggle', () => {
  it('registers a command with title "Enable Autopilot" when disabled', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    const mockApi = makeMockApi();
    await tui(mockApi);

    const commands = mockApi._getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].title).toBe('Enable Autopilot');
  });

  it('shows confirmation dialog when selecting Enable Autopilot', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    let dialogOpened = false;
    const mockApi = makeMockApi(() => { dialogOpened = true; });
    await tui(mockApi);

    const commands = mockApi._getCommands();
    commands[0].onSelect();

    expect(dialogOpened).toBe(true);
    const dialogProps = mockApi._getDialogProps();
    expect(dialogProps).toBeTruthy();
    expect(dialogProps.title).toBe('Enable Autopilot');
  });

  it('enables autopilot and updates command label after confirming dialog', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    const mockApi = makeMockApi();
    await tui(mockApi);

    // Select command to open dialog
    mockApi._getCommands()[0].onSelect();

    // Simulate user confirming
    mockApi._getDialogProps().onConfirm();

    expect(readAutopilotState().enabled).toBe(true);

    // getCommands callback always reads fresh state — label should now be "Disable Autopilot"
    expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
  });

  it('registers command with title "Disable Autopilot" when already enabled', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    const mockApi = makeMockApi();
    await tui(mockApi);

    expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
  });
});
