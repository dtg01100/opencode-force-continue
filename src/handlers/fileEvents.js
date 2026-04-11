import { sessionState } from "../state.js";

export function createFileEventsHandler(_config) {
    // The SDK's EventFileEdited type only has { file: string } — no sessionID.
    // File tracking is already handled in tool.execute.after for edit/write tools,
    // so this handler is a no-op.
    return async () => {};
}

