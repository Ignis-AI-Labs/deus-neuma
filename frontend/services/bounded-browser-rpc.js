import { FetchRequest, JsonRpcProvider } from 'ethers';

// impure — transport failures end this provider's timers and pending work.
// A new explicit caller may retry through the network cache; an idle desk must
// not repeatedly probe an endpoint its own CSP has permanently refused.
class BoundedBrowserRpc extends JsonRpcProvider {
  async _send(payload) {
    try { return await super._send(payload); }
    catch (error) {
      this.destroy();
      throw error;
    }
  }

  async _detectNetwork() {
    try { return await super._detectNetwork(); }
    catch (error) {
      this.destroy();
      throw error;
    }
  }
}

/** Create a browser provider that refuses failures without background retries. */
// impure
export const createBoundedBrowserRpc = (target) => {
  const request = new FetchRequest(target);
  request.timeout = 15_000;
  request.retryFunc = () => false;
  return new BoundedBrowserRpc(request);
};
