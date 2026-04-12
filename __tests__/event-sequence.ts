import { vi, expect } from 'vitest';

interface MockClient {
  session: {
    messages: ReturnType<typeof vi.fn>;
    promptAsync: ReturnType<typeof vi.fn>;
  };
}

interface MockContext {
  client: MockClient;
  hooks?: Record<string, any>;
  logger?: Record<string, ReturnType<typeof vi.fn>>;
}

interface EventSequence {
  events: Array<{ type: string; properties?: any; input?: any; output?: any; assertion?: (context: { plugin: any; state: any; mockClient: MockClient }) => Promise<void> | void }>;
  assertions: Array<(context: { plugin: any; state: any; mockClient: MockClient }) => Promise<void> | void>;
}

class EventSequenceBuilder {
  private events: EventSequence['events'] = [];
  private assertions: EventSequence['assertions'] = [];
  private mockClient: MockClient;
  private mockCtx: MockContext;

  constructor(mockClient: MockClient, mockCtx: MockContext) {
    this.mockClient = mockClient;
    this.mockCtx = mockCtx;
  }

  sessionCreated(sessionID: string): this {
    this.events.push({
      type: 'session.created',
      properties: { info: { id: sessionID } }
    });
    return this;
  }

  sessionDeleted(sessionID: string): this {
    this.events.push({
      type: 'session.deleted',
      properties: { sessionID }
    });
    return this;
  }

  chatMessage(sessionID: string): this {
    this.events.push({
      type: 'chat.message',
      properties: { sessionID }
    });
    return this;
  }

  sessionIdle(sessionID: string): this {
    this.events.push({
      type: 'session.idle',
      properties: { sessionID }
    });
    return this;
  }

  completionSignalCompleted(sessionID: string, input: { status: string; reason?: string } = { status: 'completed' }): this {
    this.events.push({
      type: 'message.part.updated',
      properties: {
        sessionID,
        part: {
          type: 'tool',
          tool: 'completionSignal',
          sessionID,
          state: { status: 'completed', input }
        }
      }
    });
    return this;
  }

  toolExecuteBefore(sessionID: string, tool: string, args: any): this {
    this.events.push({
      type: 'tool.execute.before',
      properties: { sessionID, tool, callID: `call-${this.events.length}` },
      output: { args }
    });
    return this;
  }

  toolExecuteAfter(sessionID: string, tool: string, args: any): this {
    this.events.push({
      type: 'tool.execute.after',
      properties: { sessionID, tool },
      input: { args }
    });
    return this;
  }

  setMessagesResponse(messages: Array<{ role: string; content?: any; parts?: any }>): this {
    this.mockClient.session.messages.mockResolvedValue({ data: messages });
    return this;
  }

  setPromptAsyncResponse(response: any): this {
    this.mockClient.session.promptAsync.mockResolvedValue(response);
    return this;
  }

  setPromptAsyncError(error: Error): this {
    this.mockClient.session.promptAsync.mockRejectedValue(error);
    return this;
  }

  assertPromptAsyncCalled(times: number): this {
    const assertion = async ({ mockClient }: { plugin: any; state: any; mockClient: MockClient }) => {
      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(times);
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  assertPromptAsyncNotCalled(): this {
    const assertion = async ({ mockClient }: { plugin: any; state: any; mockClient: MockClient }) => {
      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  assertSessionPaused(sessionID: string, reason: string | null): this {
    const assertion = async ({ state }: { plugin: any; state: any; mockClient: MockClient }) => {
      const session = state.sessions[sessionID];
      // Check new state model first, then legacy
      const paused = session?.pauseState || session?.completionState || session?.autoContinuePaused;
      if (reason === null) {
        expect(paused).toBeNull();
      } else {
        expect(paused).not.toBeNull();
        expect(paused.reason || paused.status).toBe(reason);
      }
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  assertContinuationCount(sessionID: string, count: number): this {
    const assertion = async ({ state }: { plugin: any; state: any; mockClient: MockClient }) => {
      expect(state.sessions[sessionID]?.continuationCount).toBe(count);
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  assertSessionExists(sessionID: string): this {
    const assertion = async ({ state }: { plugin: any; state: any; mockClient: MockClient }) => {
      expect(state.sessions[sessionID]).toBeDefined();
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  assertSessionNotExists(sessionID: string): this {
    const assertion = async ({ state }: { plugin: any; state: any; mockClient: MockClient }) => {
      expect(state.sessions[sessionID]).toBeUndefined();
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  assertToolCallHistoryLength(sessionID: string, length: number): this {
    const assertion = async ({ state }: { plugin: any; state: any; mockClient: MockClient }) => {
      expect(state.sessions[sessionID]?.toolCallHistory?.length).toBe(length);
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  assertFilesModified(sessionID: string, files: string[]): this {
    const assertion = async ({ state }: { plugin: any; state: any; mockClient: MockClient }) => {
      const modifiedFiles = Array.from(state.sessions[sessionID]?.filesModified || []);
      for (const file of files) {
        expect(modifiedFiles).toContain(file);
      }
    };
    this.assertions.push(assertion);
    this.events.push({ type: '__assert__', assertion });
    return this;
  }

  customAssertion(fn: (context: { plugin: any; state: any; mockClient: MockClient }) => Promise<void> | void): this {
    this.assertions.push(fn);
    this.events.push({ type: '__assert__', assertion: fn });
    return this;
  }

  async execute(plugin: any): Promise<void> {
    const { readState } = await import('../force-continue.server.js');

    for (const event of this.events) {
      if (event.type === '__assert__') {
        const state = readState();
        await event.assertion?.({ plugin, state, mockClient: this.mockClient });
      } else if (event.type.startsWith('tool.execute')) {
        if (event.type === 'tool.execute.before') {
          await plugin['tool.execute.before'](
            { sessionID: event.properties.sessionID, tool: event.properties.tool, callID: event.properties.callID },
            event.output || {}
          );
        } else if (event.type === 'tool.execute.after') {
          await plugin['tool.execute.after'](
            { sessionID: event.properties.sessionID, tool: event.properties.tool, ...event.input }
          );
        }
      } else if (event.type === 'chat.message') {
        await plugin['chat.message'](event.properties);
      } else {
        await plugin.event({ event: { type: event.type, properties: event.properties } });
      }
    }
  }

  getEvents(): EventSequence['events'] {
    return [...this.events];
  }

  getAssertions(): EventSequence['assertions'] {
    return [...this.assertions];
  }
}

export function createEventSequenceBuilder(mockClient: MockClient, mockCtx: MockContext): EventSequenceBuilder {
  return new EventSequenceBuilder(mockClient, mockCtx);
}

export function createMockClient(): MockClient {
  return {
    session: {
      messages: vi.fn(),
      promptAsync: vi.fn(),
    }
  };
}

export function createMockContext(mockClient: MockClient, hooks?: Record<string, any>): MockContext {
  return { client: mockClient, hooks };
}

export { EventSequenceBuilder };
