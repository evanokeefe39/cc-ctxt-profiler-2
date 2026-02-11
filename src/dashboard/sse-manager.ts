export type SseEventType = 'agent_update' | 'diagnostic_event' | 'session_summary';

export type SseWriteFn = (data: string) => void;

interface SseClient {
  write: SseWriteFn;
  close: () => void;
}

/**
 * Manages Server-Sent Events connections and broadcasting.
 * Transport-agnostic: stores write/close callbacks rather than raw response objects.
 */
export class SseManager {
  private clients = new Map<string, SseClient>();
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Register a new SSE client. Returns a cleanup function.
   */
  addClient(id: string, write: SseWriteFn, close: () => void): () => void {
    this.clients.set(id, { write, close });

    if (this.clients.size === 1 && !this.keepAliveInterval) {
      this.startKeepAlive();
    }

    return () => this.removeClient(id);
  }

  /**
   * Remove a client by ID.
   */
  removeClient(id: string): void {
    this.clients.delete(id);
  }

  /**
   * Broadcast a typed event to all connected clients.
   */
  broadcast(type: SseEventType, data: unknown): void {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, client] of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(id);
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
    for (const [, client] of this.clients) {
      try {
        client.close();
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
      for (const [id, client] of this.clients) {
        try {
          client.write(':ping\n\n');
        } catch {
          this.clients.delete(id);
        }
      }
    }, 15_000);
  }
}
