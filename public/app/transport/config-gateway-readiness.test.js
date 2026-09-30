// ABOUTME: Tests config gateway readiness.
// ABOUTME: Includes "announces readiness only after the host transport connects".
import { describe, expect, it, vi } from "vitest";

import {
  createConfigGatewayConnectionListener,
  onConfigGatewayReady,
  signalConfigGatewayReady,
} from "./config-gateway-readiness.js";

describe("config gateway readiness", () => {
  it("announces readiness only after the host transport connects", () => {
    let listener;
    const adapter = {
      setConnectionListener: vi.fn((nextListener) => {
        listener = nextListener;
      }),
    };
    const ready = vi.fn();
    const unbind = onConfigGatewayReady(ready);

    createConfigGatewayConnectionListener({ adapter });
    expect(ready).not.toHaveBeenCalled();

    listener(true);
    expect(ready).toHaveBeenCalledTimes(1);
    unbind();
  });

  it("reports disconnects without announcing readiness", () => {
    let listener;
    const adapter = {
      setConnectionListener: vi.fn((nextListener) => {
        listener = nextListener;
      }),
    };
    const ready = vi.fn();
    const onDisconnected = vi.fn();
    const unbind = onConfigGatewayReady(ready);

    createConfigGatewayConnectionListener({ adapter, onDisconnected });
    listener(false);

    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    unbind();
  });

  it("does not announce a connection before the active target is ready", () => {
    let listener;
    const adapter = {
      setConnectionListener: vi.fn((nextListener) => {
        listener = nextListener;
      }),
    };
    const ready = vi.fn();
    const unbind = onConfigGatewayReady(ready);

    createConfigGatewayConnectionListener({ adapter, isReady: () => false });
    listener(true);

    expect(ready).not.toHaveBeenCalled();
    unbind();
  });

  it("can announce readiness after the active target is subscribed", () => {
    const ready = vi.fn();
    const unbind = onConfigGatewayReady(ready);

    signalConfigGatewayReady();

    expect(ready).toHaveBeenCalledOnce();
    unbind();
  });
});
