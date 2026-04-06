import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState, writeAutopilotState, readAutopilotState } from '../src/autopilot.js';

describe('TUI cancel behavior', () => {
  it('cancelling DialogConfirm leaves autopilot disabled', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    let getCommandsFn: (() => any[]) | null = null;
    let dialogProps: any = null;

    const mockApi: any = {
      command: {
        register: (fn: any) => {
          getCommandsFn = fn;
          return () => {};
        },
      },
      ui: {
        dialog: {
          replace: (renderFn: () => any) => { renderFn(); },
          clear: () => {},
        },
        DialogConfirm: (props: any) => {
          dialogProps = props;
          return null;
        },
        toast: (_: any) => {},
      },
    };

    await tui(mockApi);

    const commands = getCommandsFn!();
    expect(commands[0].title).toBe('Enable Autopilot');

    // Select command — opens dialog
    commands[0].onSelect();
    expect(dialogProps).toBeTruthy();

    // Cancel the dialog
    dialogProps.onCancel?.();

    // State must remain disabled
    expect(readAutopilotState().enabled).toBe(false);

    // Fresh commands still show "Enable Autopilot"
    expect(getCommandsFn!()[0].title).toBe('Enable Autopilot');
  });
});
