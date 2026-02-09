declare module '@shopify/app-bridge-utils' {
  export function authenticatedFetch(
    app: unknown
  ): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  export function getSessionToken(app: unknown): Promise<string>;
}
