/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API. Empty = same origin. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
