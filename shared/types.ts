export type ContentType = "text" | "image" | "audio" | "video";
export type Platform = "instagram" | "tiktok" | "youtube" | "linkedin" | "x";
export type Goal = "reach" | "engagement" | "community" | "conversions";
export interface MediaMetadata {
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  brightness?: number;
  contrast?: number;
  audioPeak?: number;
  silenceRatio?: number;
  transcript?: string;
  frameCount?: number;
}
export interface AnalysisInput {
  title: string;
  text: string;
  type: ContentType;
  platform: Platform;
  goal: Goal;
  audience: string;
  timezone: string;
  media?: MediaMetadata;
}
export interface Dimension {
  id: string;
  label: string;
  score: number;
  weight: number;
  explanation: string;
}
export interface Suggestion {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  example?: string;
  dimension: string;
}
export interface PublishSlot {
  day: string;
  dayIndex: number;
  hour: number;
  label: string;
  strength: number;
  reason: string;
}
export interface AnalysisResult {
  score: number;
  verdict: string;
  summary: string;
  confidence: "low" | "medium";
  mode: "local" | "ai";
  dimensions: Dimension[];
  suggestions: Suggestion[];
  strengths: string[];
  optimizedText: string;
  hooks: string[];
  hashtags: string[];
  publishing: {
    timezone: string;
    slots: PublishSlot[];
    heatmap: number[][];
    basis: string;
  };
  metrics: { label: string; value: string; detail: string }[];
  limitations: string[];
}
export interface AnalysisRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: AnalysisInput;
  result: AnalysisResult;
  scheduledAt?: string;
  status: "analyzed" | "scheduled" | "published";
  outcomes?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  };
}
export interface Capabilities {
  aiEnabled: boolean;
  mediaEnabled: boolean;
  maxUploadMb: number;
  model: string | null;
  storageMode?: "browser" | "server";
  maxUploadBytes?: number;
}
