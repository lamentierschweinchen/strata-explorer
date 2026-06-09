/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Solana JSON-RPC HTTP endpoint (e.g. a Helius URL). Defaults to public mainnet. */
  readonly VITE_SOLANA_RPC_HTTP?: string;
  /** Solana JSON-RPC WebSocket endpoint. Defaults to the ws:// form of the HTTP URL. */
  readonly VITE_SOLANA_RPC_WS?: string;
  /** Force a data source: 'live' (default) or 'mock'. */
  readonly VITE_DATA_SOURCE?: 'live' | 'mock';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
