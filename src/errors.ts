export interface SnErrorShape {
  status: number;
  message: string;
  detail?: string;
}

export class SnApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(shape: SnErrorShape) {
    super(shape.message);
    this.name = 'SnApiError';
    this.status = shape.status;
    this.detail = shape.detail;
  }
}

export interface ToolErrorResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent: { error: SnErrorShape };
  isError: true;
}

/**
 * Single place that converts any thrown error into the MCP tool error
 * convention: human-readable text + structuredContent + isError.
 */
export function toToolErrorResult(err: unknown): ToolErrorResult {
  const shape: SnErrorShape =
    err instanceof SnApiError
      ? { status: err.status, message: err.message, detail: err.detail }
      : { status: 0, message: err instanceof Error ? err.message : String(err) };
  const text = shape.detail ? `${shape.message}\n${shape.detail}` : shape.message;
  const prefix = shape.status > 0 ? `Error (HTTP ${shape.status})` : 'Error';
  return {
    content: [{ type: 'text', text: `${prefix}: ${text}` }],
    structuredContent: { error: shape },
    isError: true,
  };
}
