import type { ServerResponse } from 'node:http';

export type SseEventType = 'agent_update' | 'diagnostic_event' | 'session_summary';

/**
 * Manages Server-Sent Events connections and broadcasting.
 */
export class SseManager {
  private clients = new Set<ServerResponse>();
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Add a new SSE client connection.
   */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial comment to establish connection
    res.write(':ok\n\n');

    this.clients.add(res);

    res.on('close', () => {
      this.clients.delete(res);
    });

    // Start keepalive if this is the first client
    if (this.clients.size === 1 && !this.keepAliveInterval) {
      this.startKeepAlive();
    }
  }

  /**
   * Broadcast a typed event to all connected clients.
   */
  broadcast(type: SseEventType, data: unknown): void {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Get the number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Stop keepalive and close all connections.
   */
  close(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }

  private startKeepAlive(): void {
    this.keepAliveInterval = setInterval(() => {
      if (this.clients.size === 0) {
        clearInterval(this.keepAliveInterval!);
        this.keepAliveInterval = null;
        return;
      }
      for (const client of this.clients) {
        try {
          client.write(':ping\n\n');
        } catch {
          this.clients.delete(client);
        }
      }
    }, 15_000);
  }
}
