import { describe, expect, it, vi } from 'vitest';
import { Gateway } from '../src/realtime/gateway.js';

describe('Gateway conversation broadcasts', () => {
  it('can exclude the sender user room to prevent duplicate sender events', () => {
    const emit = vi.fn();
    const except = vi.fn(() => ({ emit }));
    const broadcast = { except };
    const io = { to: vi.fn(() => broadcast) };
    const gateway = new Gateway();
    gateway.attach(io);

    const payload = { message: { _id: 'message-id' } };
    gateway.emitToConversation('conversation-id', 'message:new', payload, {
      excludeUserId: 'sender-id',
    });

    expect(io.to).toHaveBeenCalledWith('conv:conversation-id');
    expect(except).toHaveBeenCalledWith('user:sender-id');
    expect(emit).toHaveBeenCalledWith('message:new', payload);
  });

  it('keeps unscoped conversation broadcasts unchanged', () => {
    const emit = vi.fn();
    const broadcast = { emit };
    const io = { to: vi.fn(() => broadcast) };
    const gateway = new Gateway();
    gateway.attach(io);

    gateway.emitToConversation('conversation-id', 'typing', { isTyping: true });

    expect(io.to).toHaveBeenCalledWith('conv:conversation-id');
    expect(emit).toHaveBeenCalledWith('typing', { isTyping: true });
  });
});
