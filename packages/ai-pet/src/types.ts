export interface RecommendedSite {
  id: string; name: string; description: string; url: string;
  icon?: string; category?: string; tags?: readonly string[]; owned?: boolean;
}
export interface AssistantConfig {
  greeting?: string;
  welcomeQuestions?: readonly { id: string; label: string; question: string }[];
  sites?: readonly RecommendedSite[];
  siteOrigin?: string;
}
