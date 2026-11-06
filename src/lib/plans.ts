export type PlanId = 'starter' | 'business' | 'business-ai';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyPrice: number;
  annualMonthlyPrice: number;
  description: string;
  features: string[];
}

export const PLANS: PlanDefinition[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    description: 'Get started with video communication.',
    features: [
      'Up to 10 workspace members',
      'Store up to 25 videos',
      'Videos up to 5 minutes',
      '720p recording quality',
      'Unlimited screenshots and meeting recordings',
      'Meeting recordings have no 5-minute cap',
      'Screen, camera bubble, and camera-only recording',
      'Capture tab or system audio where supported by the browser',
      'Circle, rounded, or square camera frames',
      'Green-screen virtual background presets',
      'Personal and shared workspace libraries, archive, folders, and Spaces',
      'Comments, emoji reactions, optional live captions, and transcript cues',
      'Watch later and per-video viewer insights',
      'Animated GIF video thumbnails',
      'Privacy controls for each recording',
      'Share links (requires workspace cloud storage)',
      'Workspace roles and recording ownership transfer',
      'Verified-domain workspace capture',
      'Slack contact sync and channel sharing (requires Slack setup)',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    monthlyPrice: 18,
    annualMonthlyPrice: 15,
    description: 'Move work forward with unlimited video messages and basic editing.',
    features: ['Unlimited recordings and recording time', 'Background noise suppression', 'Workspace-wide privacy defaults', 'Upload and download videos', 'Basic video trimming', 'Search videos and workspace content', 'Workspace engagement insights', 'Embed Looms', 'All Starter features'],
  },
  {
    id: 'business-ai',
    name: 'Business + AI',
    monthlyPrice: 24,
    annualMonthlyPrice: 20,
    description: 'Business features with AI-assisted video workflows.',
    features: ['Everything in Business', 'AI titles, summaries, and transcripts (coming soon)', 'Meeting recaps (coming soon)', 'Advanced editing tools (coming soon)'],
  },
];

export const PLAN_CAPABILITIES: Record<PlanId, {
  maxUsers: number;
  maxVideos: number;
  maxRecordingSeconds: number;
  canUpload: boolean;
  canDownload: boolean;
  canTrim: boolean;
  canSearch: boolean;
  canSuppressBackgroundNoise: boolean;
  canViewEngagementInsights: boolean;
  canEmbed: boolean;
  hasAi: boolean;
}> = {
  starter: { maxUsers: 10, maxVideos: 25, maxRecordingSeconds: 300, canUpload: false, canDownload: false, canTrim: false, canSearch: false, canSuppressBackgroundNoise: false, canViewEngagementInsights: false, canEmbed: false, hasAi: false },
  business: { maxUsers: 50_000, maxVideos: Infinity, maxRecordingSeconds: Infinity, canUpload: true, canDownload: true, canTrim: true, canSearch: true, canSuppressBackgroundNoise: true, canViewEngagementInsights: true, canEmbed: true, hasAi: false },
  'business-ai': { maxUsers: 50_000, maxVideos: Infinity, maxRecordingSeconds: Infinity, canUpload: true, canDownload: true, canTrim: true, canSearch: true, canSuppressBackgroundNoise: true, canViewEngagementInsights: true, canEmbed: true, hasAi: true },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === 'starter' || value === 'business' || value === 'business-ai';
}
