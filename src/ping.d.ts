declare module 'ping' {
  interface PingResponse {
    alive: boolean;
    host: string;
    output: string;
    time: number | string;
    times: number[];
    min: string;
    max: string;
    avg: string;
    stddev: string;
    packetLoss: string;
  }

  interface PingOptions {
    timeout?: number;
    v6?: boolean;
  }

  const promise: {
    probe(host: string, options?: PingOptions): Promise<PingResponse>;
  };

  export { promise, PingResponse, PingOptions };
}
