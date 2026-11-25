export interface AppConfigCall {
  id: string;
  title: string;
  summary: string;
  priority: string;
  status: string;
  created_at: number;
  answered_at: number | null;
  ended_at: number | null;
  ended_by: string | null;
  fish_session_id: string | null;
  agent_following: boolean;
}

export interface AppConfig {
  origin: string;
  agent_api_key: string;
  user_email: string | null;
  vapid_public_key: string | null;
  fish_agent: { configured: boolean; name?: string; status?: string; publication_state?: string };
  recent_calls?: AppConfigCall[];
  configs: {
    chatgpt: { label: string; url: string; note: string };
    claude: { label: string; json: unknown };
    cursor: { label: string; json: unknown };
    rest: { label: string; notify: string; poll: string; send: string };
    mcp_json: { label: string; json: unknown };
  };
}

export type BubbleRole = "user" | "agent" | "update" | "system";

export interface Bubble {
  key: string;
  role: BubbleRole;
  text: string;
  final?: boolean;
  ts: number;
}

export interface ActiveCall {
  id: string;
  title: string;
  summary: string;
  startedAt: number;
  status: "connecting" | "connected" | "ended" | "error";
  mode: "listening" | "thinking" | "speaking";
  muted: boolean;
  endReason?: string;
}
