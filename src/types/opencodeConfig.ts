// oh-my-opencode configuration types
// Reference: comment-json configuration structure

/**
 * Agent configuration - defines how an agent behaves
 * All fields are optional as configuration may be partial
 */
export interface AgentConfig {
  /** Model identifier (e.g., 'claude-3-5-sonnet-20241022') */
  model?: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Top-p sampling parameter (0-1) */
  top_p?: number;
  /** Maximum tokens per response */
  max_tokens?: number;
  /** System prompt override for this agent */
  system?: string;
  /** Additional model-specific parameters */
  [key: string]: unknown;
}

/**
 * OhMyOpencode configuration
 * Root configuration object for oh-my-opencode
 * All fields are optional as configuration may be partial
 */
export interface OhMyOpencodeConfig {
  /** Global agent configurations keyed by agent name */
  agents?: Record<string, AgentConfig>;
  /** Default agent configuration to use as base */
  defaultAgent?: AgentConfig;
  /** Project-specific settings */
  project?: {
    /** Project name */
    name?: string;
    /** Working directory */
    cwd?: string;
  };
  /** Runtime configuration */
  runtime?: {
    /** Enable/disable features */
    features?: {
      /** Enable auto-approval for safe operations */
      autoApprove?: boolean;
      /** Enable verbose logging */
      verbose?: boolean;
      /** Enable debug mode */
      debug?: boolean;
    };
    /** Maximum retry attempts */
    maxRetries?: number;
    /** Request timeout in milliseconds */
    timeout?: number;
  };
  /** Tool-specific configurations */
  tools?: Record<string, unknown>;
  /** Custom environment variables */
  env?: Record<string, string>;
  /** Additional custom configuration */
  [key: string]: unknown;
}
