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
 * Category configuration - defines model settings for task categories
 * Categories are used by task() to select appropriate models
 * All fields are optional as configuration may be partial
 */
export interface CategoryConfig {
  /** Model identifier (e.g., 'google/gemini-3.1-pro') */
  model?: string;
  /** Model variant (e.g., 'max', 'high', 'medium', 'low', 'xhigh') */
  variant?: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Top-p sampling parameter (0-1) */
  top_p?: number;
  /** Additional system prompt to append */
  prompt_append?: string;
  /** Human-readable description */
  description?: string;
}

/**
 * OhMyOpencode configuration
 * Root configuration object for oh-my-opencode
 * All fields are optional as configuration may be partial
 */
export interface OhMyOpencodeConfig {
  /** Global agent configurations keyed by agent name */
  agents?: Record<string, AgentConfig>;
  /** Category configurations for task type model selection */
  categories?: Record<string, CategoryConfig>;
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

/**
 * Profile configuration - defines agent and category settings for a profile
 * Profiles allow switching between different agent/category configurations
 */
export interface ProfileConfig {
  /** Agent configurations keyed by agent name */
  agents: Record<string, AgentConfig>;
  /** Category configurations for task type model selection */
  categories?: Record<string, CategoryConfig>;
}

/**
 * Profile - represents a named configuration profile
 * Profiles can be built-in or user-created
 */
export interface Profile {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Emoji icon for display */
  emoji: string;
  /** Optional description */
  description?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Whether this is a default system profile */
  isDefault?: boolean;
  /** Whether this is a built-in profile that cannot be deleted */
  isBuiltIn?: boolean;
}

/**
 * Profile index - tracks all profiles and active selection
 * This is the top-level structure for profile management
 */
export interface ProfileIndex {
  /** Schema version for migrations */
  version: number;
  /** All available profiles */
  profiles: Profile[];
  /** Currently active profile ID */
  activeProfileId: string | null;
  /** Last modification timestamp */
  lastModified: string;
}
