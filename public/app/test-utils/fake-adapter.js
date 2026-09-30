// ABOUTME: Test double for the host transport adapter used by preference tests.
// ABOUTME: Records sent frames and delivers receive and disconnect callbacks.

export function createFakeAdapter() {
  const listeners = { receiver: null, connection: null };
  return {
    sent: [],
    setReceiver(fn) {
      listeners.receiver = fn;
    },
    setConnectionListener(fn) {
      listeners.connection = fn;
    },
    send(frame) {
      this.sent.push(frame);
    },
    receive(frame) {
      listeners.receiver?.(frame);
    },
    disconnect() {
      listeners.connection?.(false);
    },
  };
}
