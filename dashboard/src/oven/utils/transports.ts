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
