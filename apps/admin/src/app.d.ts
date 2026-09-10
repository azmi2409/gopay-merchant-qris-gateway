declare global {
  namespace App {
    interface Locals {
      sessionId: string | null;
      authenticated: boolean;
    }
  }
}

export {};
