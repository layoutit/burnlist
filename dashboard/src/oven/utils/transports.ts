export function createPollTransport({
  makeUrl,
  intervalMs,
  receive,
  fallbackError,
  inFlightRef = { current: false },
  fetchImpl = fetch,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  return {
    start({ onData, onError, onSettled }) {
      let cancelled = false;

      const refresh = async () => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        try {
          const response = await fetchImpl(makeUrl(), { cache: "no-store" });
          const json = await response.json();
          const data = receive(response, json);
          if (!cancelled) onData(data);
        } catch (cause) {
          if (!cancelled) onError(cause instanceof Error ? cause.message : fallbackError);
        } finally {
          inFlightRef.current = false;
          if (!cancelled) onSettled();
        }
      };

      void refresh();
      const timer = setIntervalImpl(refresh, intervalMs);
      return () => {
        cancelled = true;
        clearIntervalImpl(timer);
      };
    },
  };
}

export function createSseTransport({ makeUrl, EventSourceImpl = EventSource }) {
  return {
    start({ onReset, onOpen, onMessage, onError }) {
      const url = makeUrl();
      const stream = new EventSourceImpl(url);
      const reset = () => onReset();
      stream.addEventListener("reset", reset);
      stream.onopen = () => onOpen();
      stream.onmessage = (event) => onMessage(event.data);
      stream.onerror = () => onError();
      return () => {
        stream.removeEventListener("reset", reset);
        stream.close();
      };
    },
  };
}
